const undoStack = [];
const redoStack = [];
const listeners = new Set();

export function recordAction(action) {
  undoStack.push(action);
  redoStack.length = 0;
  notifyHistory();
}

export function undo() {
  if (undoStack.length === 0) return null;
  const action = undoStack.pop();
  if (action && typeof action.undo === 'function') {
    action.undo();
  }
  redoStack.push(action);
  notifyHistory();
  return action;
}

export function redo() {
  if (redoStack.length === 0) return null;
  const action = redoStack.pop();
  if (action && typeof action.redo === 'function') {
    action.redo();
  }
  undoStack.push(action);
  notifyHistory();
  return action;
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

export function subscribeHistory(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyHistory() {
  const status = { canUndo: canUndo(), canRedo: canRedo() };
  for (const fn of listeners) {
    fn(status);
  }
}
