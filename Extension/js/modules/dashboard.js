'use strict';

window.DashboardModule = function DashboardModule() {
    this.stickyId  = 'dashboard-sticky-note';
    this.todoInputId = 'todo-input';
    this.todoBtnId   = 'btn-add-todo';
    this.todoListId  = 'todo-list';
};

DashboardModule.prototype.init = function () {
    this.loadData();
    this.setupListeners();
    // Request fresh project dashboard state from parent editor if running in iframe
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'fishtools-request-dashboard' }, '*');
        }
    } catch (_) {}
};

DashboardModule.prototype.setupListeners = function () {
    var self = this;

    var sticky = document.getElementById(this.stickyId);
    if (sticky) {
        sticky.addEventListener('input', function () { self.saveData(); });
    }

    var btn   = document.getElementById(this.todoBtnId);
    var input = document.getElementById(this.todoInputId);
    if (btn && input) {
        btn.addEventListener('click', function () { self.addTodo(); });
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') self.addTodo();
        });
    }

    // Listen for sync messages from parent project in FishTools Studio
    window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'fishtools-sync-dashboard') {
            self.loadData(e.data.dashboard);
        }
    });
};

DashboardModule.prototype.addTodo = function () {
    var input = document.getElementById(this.todoInputId);
    var text  = input.value.trim();
    if (!text) return;

    var item = { id: Date.now(), text: text, completed: false };
    this.renderTodo(item);
    input.value = '';
    this.saveData();
};

DashboardModule.prototype.renderTodo = function (item) {
    var self = this;
    var list = document.getElementById(this.todoListId);
    if (!list) return;

    var li = document.createElement('li');
    li.className = 'todo-item' + (item.completed ? ' completed' : '');
    li.setAttribute('data-id', item.id);

    li.innerHTML = [
        '<button class="btn-done" title="Toggle Done">',
        '<span class="material-icons">' + (item.completed ? 'check_circle' : 'radio_button_unchecked') + '</span>',
        '</button>',
        '<span class="todo-text">' + item.text + '</span>',
        '<button class="btn-delete" title="Delete"><span class="material-icons">delete</span></button>'
    ].join('');

    li.querySelector('.btn-done').addEventListener('click', function () {
        item.completed = !item.completed;
        li.classList.toggle('completed');
        this.querySelector('.material-icons').textContent = item.completed ? 'check_circle' : 'radio_button_unchecked';
        self.saveData();
    });

    li.querySelector('.btn-delete').addEventListener('click', function () {
        li.remove();
        self.saveData();
    });

    list.appendChild(li);
};

DashboardModule.prototype.saveData = function () {
    var sticky = document.getElementById(this.stickyId);
    var todoItems = [];
    document.querySelectorAll('.todo-item').forEach(function (el) {
        var textEl = el.querySelector('.todo-text');
        todoItems.push({
            id:        el.getAttribute('data-id'),
            text:      textEl ? textEl.textContent : '',
            completed: el.classList.contains('completed')
        });
    });

    var data = {
        sticky: sticky ? sticky.value : '',
        todos:  todoItems
    };

    // 1. Direct parent window project sync (FishTools Studio currentProjectState)
    try {
        if (window.parent && window.parent !== window && window.parent.currentProjectState) {
            window.parent.currentProjectState.dashboard = data;
            if (typeof window.parent.saveCurrentProjectLayers === 'function') {
                window.parent.saveCurrentProjectLayers(true);
            }
        }
    } catch (_) {}

    // 2. PostMessage to parent window (cross-frame guarantee)
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'fishtools-save-dashboard',
                dashboard: data
            }, '*');
        }
    } catch (_) {}

    // 3. Fallback: Save to FileStore / localStorage
    if (window.FileStore) {
        window.FileStore.set('dashboard', data);
    }
};

DashboardModule.prototype.loadData = function (providedData) {
    var data = providedData;

    // 1. If no data provided, try reading directly from parent project
    if (!data) {
        try {
            if (window.parent && window.parent !== window && window.parent.currentProjectState && window.parent.currentProjectState.dashboard) {
                data = window.parent.currentProjectState.dashboard;
            }
        } catch (_) {}
    }

    // 2. Fallback to FileStore
    if (!data && window.FileStore) {
        data = window.FileStore.get('dashboard');
    }

    try {
        var sticky = document.getElementById(this.stickyId);
        if (sticky) {
            sticky.value = (data && typeof data.sticky === 'string') ? data.sticky : '';
        }

        var list = document.getElementById(this.todoListId);
        if (list) {
            list.innerHTML = '';
        }

        if (data && Array.isArray(data.todos)) {
            var self = this;
            data.todos.forEach(function (item) { self.renderTodo(item); });
        }
    } catch (e) {
        console.error('Dashboard load failure:', e);
    }
};
