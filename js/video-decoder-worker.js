/**
 * FishTool Studio - WebCodecs Video Decoder Worker
 * High-performance background demuxer & hardware video decoder.
 * Handles MP4 parsing, sync sample (keyframe) seeking, and mobile-safe VideoFrame memory disposal.
 */

'use strict';

// Active video streams indexed by mediaId
const streams = new Map();

/**
 * Minimalist Fast MP4 Box Parser
 */
class MP4Demuxer {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.view = new DataView(arrayBuffer);
    this.tracks = [];
    this.videoTrack = null;
    this._parse();
  }

  _parse() {
    let offset = 0;
    const len = this.buffer.byteLength;

    while (offset + 8 <= len) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : (size === 0 ? len - offset : size);
      const headerSize = size === 1 ? 16 : 8;

      if (type === 'moov') {
        this._parseMoov(offset + headerSize, offset + boxSize);
        break; // moov parsed, we have metadata
      }

      if (boxSize <= 0) break;
      offset += boxSize;
    }
  }

  _parseMoov(start, end) {
    let offset = start;
    while (offset + 8 <= end) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : size;
      const headerSize = size === 1 ? 16 : 8;

      if (type === 'trak') {
        const track = this._parseTrak(offset + headerSize, offset + boxSize);
        if (track && track.isVideo) {
          this.videoTrack = track;
          this.tracks.push(track);
        }
      }

      if (boxSize <= 0) break;
      offset += boxSize;
    }
  }

  _parseTrak(start, end) {
    let offset = start;
    let isVideo = false;
    let mdiaStart = 0, mdiaEnd = 0;

    while (offset + 8 <= end) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : size;
      const headerSize = size === 1 ? 16 : 8;

      if (type === 'mdia') {
        mdiaStart = offset + headerSize;
        mdiaEnd = offset + boxSize;
      }

      if (boxSize <= 0) break;
      offset += boxSize;
    }

    if (!mdiaStart) return null;

    offset = mdiaStart;
    let timescale = 1000;
    let stblStart = 0, stblEnd = 0;

    while (offset + 8 <= mdiaEnd) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : size;
      const headerSize = size === 1 ? 16 : 8;

      if (type === 'mdhd') {
        const version = this.view.getUint8(offset + headerSize);
        timescale = version === 1 ? this.view.getUint32(offset + headerSize + 20) : this.view.getUint32(offset + headerSize + 12);
      } else if (type === 'hdlr') {
        const handlerType = this._readString(offset + headerSize + 8, 4);
        if (handlerType === 'vide') isVideo = true;
      } else if (type === 'minf') {
        const minfBoxes = this._findSubBoxes(offset + headerSize, offset + boxSize);
        const stblBox = minfBoxes.find(b => b.type === 'stbl');
        if (stblBox) {
          stblStart = stblBox.start;
          stblEnd = stblBox.end;
        }
      }

      if (boxSize <= 0) break;
      offset += boxSize;
    }

    if (!isVideo || !stblStart) return null;

    return this._parseStbl(stblStart, stblEnd, timescale);
  }

  _parseStbl(start, end, timescale) {
    const boxes = this._findSubBoxes(start, end);
    let codec = 'avc1.4d401f';
    let width = 1920, height = 1080;
    let description = null;
    let sampleDurations = [];
    let keyframeIndexes = null;
    let sampleSizes = [];
    let chunkOffsets = [];
    let sampleToChunk = [];

    for (const box of boxes) {
      const p = box.start;
      if (box.type === 'stsd') {
        // Sample Description Box
        const entryCount = this.view.getUint32(p + 4);
        if (entryCount > 0) {
          const entryStart = p + 8;
          const format = this._readString(entryStart + 4, 4);
          width = this.view.getUint16(entryStart + 28);
          height = this.view.getUint16(entryStart + 30);

          // Find avcC or hvcC extradata
          const subBoxes = this._findSubBoxes(entryStart + 78, entryStart + this.view.getUint32(entryStart));
          const avcC = subBoxes.find(b => b.type === 'avcC' || b.type === 'hvcC');
          if (avcC) {
            description = new Uint8Array(this.buffer, avcC.start - 8, avcC.end - avcC.start + 8);
            if (avcC.type === 'avcC') {
              const profile = this.view.getUint8(avcC.start + 1).toString(16).padStart(2, '0');
              const compat = this.view.getUint8(avcC.start + 2).toString(16).padStart(2, '0');
              const level = this.view.getUint8(avcC.start + 3).toString(16).padStart(2, '0');
              codec = `avc1.${profile}${compat}${level}`;
            } else {
              codec = 'hvc1.1.6.L93.B0';
            }
          }
        }
      } else if (box.type === 'stts') {
        // Time to sample
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count; i++) {
          const sCount = this.view.getUint32(ptr);
          const sDelta = this.view.getUint32(ptr + 4);
          ptr += 8;
          for (let j = 0; j < sCount; j++) {
            sampleDurations.push(sDelta);
          }
        }
      } else if (box.type === 'stss') {
        // Sync sample (Keyframes)
        const count = this.view.getUint32(p + 4);
        keyframeIndexes = new Set();
        let ptr = p + 8;
        for (let i = 0; i < count; i++) {
          keyframeIndexes.add(this.view.getUint32(ptr) - 1); // 0-based
          ptr += 4;
        }
      } else if (box.type === 'stsz') {
        // Sample sizes
        const uniformSize = this.view.getUint32(p + 4);
        const count = this.view.getUint32(p + 8);
        let ptr = p + 12;
        for (let i = 0; i < count; i++) {
          sampleSizes.push(uniformSize || this.view.getUint32(ptr));
          if (!uniformSize) ptr += 4;
        }
      } else if (box.type === 'stsc') {
        // Sample to chunk
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count; i++) {
          sampleToChunk.push({
            firstChunk: this.view.getUint32(ptr),
            samplesPerChunk: this.view.getUint32(ptr + 4),
            sampleDescIdx: this.view.getUint32(ptr + 8)
          });
          ptr += 12;
        }
      } else if (box.type === 'stco') {
        // 32-bit chunk offsets
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count; i++) {
          chunkOffsets.push(this.view.getUint32(ptr));
          ptr += 4;
        }
      } else if (box.type === 'co64') {
        // 64-bit chunk offsets
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count; i++) {
          chunkOffsets.push(Number(this.view.getBigUint64(ptr)));
          ptr += 8;
        }
      }
    }

    // Build sample map (PTS, fileOffset, size, isKeyframe)
    const samples = [];
    let curTime = 0;
    let chunkIdx = 0;
    let sampleInChunk = 0;
    let curChunkOffset = chunkOffsets[0] || 0;
    let stscIdx = 0;

    for (let i = 0; i < sampleSizes.length; i++) {
      const isKey = keyframeIndexes ? keyframeIndexes.has(i) : (i === 0);
      const size = sampleSizes[i];
      const dur = sampleDurations[i] || (sampleDurations[0] || 1);
      const ptsSec = curTime / timescale;

      // Find samplesPerChunk for current chunk (1-based chunk numbers in stsc)
      while (stscIdx + 1 < sampleToChunk.length && (chunkIdx + 1) >= sampleToChunk[stscIdx + 1].firstChunk) {
        stscIdx++;
      }
      const samplesPerChunk = sampleToChunk[stscIdx] ? sampleToChunk[stscIdx].samplesPerChunk : 1;

      samples.push({
        index: i,
        offset: curChunkOffset,
        size: size,
        pts: ptsSec,
        duration: dur / timescale,
        isKey: isKey
      });

      curChunkOffset += size;
      sampleInChunk++;
      if (sampleInChunk >= samplesPerChunk) {
        chunkIdx++;
        sampleInChunk = 0;
        curChunkOffset = chunkOffsets[chunkIdx] || 0;
      }
      curTime += dur;
    }

    const totalDurationSec = curTime / timescale;

    return {
      isVideo: true,
      codec: codec,
      width: width,
      height: height,
      description: description,
      timescale: timescale,
      duration: totalDurationSec,
      samples: samples
    };
  }

  _findSubBoxes(start, end) {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= end) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : size;
      const headerSize = size === 1 ? 16 : 8;

      if (boxSize <= 0) break;
      boxes.push({ type, start: offset + headerSize, end: offset + boxSize });
      offset += boxSize;
    }
    return boxes;
  }

  _readString(offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      str += String.fromCharCode(this.view.getUint8(offset + i));
    }
    return str;
  }
}

/**
 * Worker Video Stream Controller
 */
class VideoStream {
  constructor(mediaId, arrayBuffer) {
    this.mediaId = mediaId;
    this.buffer = arrayBuffer;
    this.demuxer = new MP4Demuxer(arrayBuffer);
    this.track = this.demuxer.videoTrack;
    this.decoder = null;
    this.currentSeekResolve = null;

    if (this.track) {
      this._initDecoder();
    }
  }

  _initDecoder() {
    if (typeof VideoDecoder === 'undefined') {
      return;
    }

    this.config = {
      codec: this.track.codec,
      codedWidth: this.track.width,
      codedHeight: this.track.height,
      optimizeForLatency: true
    };

    if (this.track.description) {
      this.config.description = this.track.description;
    }

    this.decoder = new VideoDecoder({
      output: (videoFrame) => this._onVideoFrame(videoFrame),
      error: (err) => {
        console.warn(`[WebCodecs] Decoder error on media ${this.mediaId}:`, err);
      }
    });

    try {
      this.decoder.configure(this.config);
    } catch (err) {
      delete this.config.description;
      try { this.decoder.configure(this.config); } catch (_) {}
    }
  }

  async _onVideoFrame(videoFrame) {
    try {
      const pts = videoFrame.timestamp;

      // For intermediate reference frames before the target timestamp,
      // decode in hardware but close VideoFrame immediately (0.02ms) without allocating ImageBitmap!
      if (this.targetPtsUs !== null && this.targetPtsUs !== undefined && pts < (this.targetPtsUs - 40000)) {
        videoFrame.close();
        return;
      }

      // Convert target frame to ImageBitmap and immediately close hardware VideoFrame
      const bitmap = await createImageBitmap(videoFrame);
      videoFrame.close();

      // Store latest decoded bitmap (replacing any previous intermediate frame)
      if (this.latestSeekBitmap) {
        try { this.latestSeekBitmap.close(); } catch (_) {}
      }
      this.latestSeekBitmap = bitmap;

      // If frame reached or closely matched targetPtsUs (within 50ms tolerance), resolve immediately
      if (this.targetPtsUs === null || this.targetPtsUs === undefined || pts >= (this.targetPtsUs - 50000)) {
        if (this.currentSeekResolve) {
          const resolve = this.currentSeekResolve;
          this.currentSeekResolve = null;
          this.targetPtsUs = null;
          this.latestSeekBitmap = null;
          resolve(bitmap);
        }
      }
    } catch (err) {
      try { videoFrame.close(); } catch (_) {}
    }
  }

  /**
   * Seeks to closest frame at or before targetSec
   */
  async seek(targetSec) {
    if (!this.track || !this.track.samples.length) return null;

    const samples = this.track.samples;
    // Find closest sample index
    let targetIdx = 0;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].pts <= targetSec) {
        targetIdx = i;
      } else {
        break;
      }
    }

    // Find nearest preceding sync sample (Keyframe / I-Frame)
    let keyIdx = targetIdx;
    while (keyIdx > 0 && !samples[keyIdx].isKey) {
      keyIdx--;
    }

    if (!this.decoder || this.decoder.state === 'closed') {
      this._initDecoder();
    }
    if (!this.decoder) {
      return null;
    }

    // Cancel previous in-flight seek if any
    if (this.currentSeekResolve) {
      const oldResolve = this.currentSeekResolve;
      this.currentSeekResolve = null;
      oldResolve(null);
    }

    const targetPtsUs = Math.round(samples[targetIdx].pts * 1000000);
    this.targetPtsUs = targetPtsUs;

    return new Promise((resolve) => {
      this.currentSeekResolve = resolve;

      try {
        if (this.decoder.state === 'configured') {
          this.decoder.reset();
          this.decoder.configure(this.config);
        } else {
          this._initDecoder();
        }

        // Feed chunks from keyframe up to target frame
        for (let i = keyIdx; i <= targetIdx; i++) {
          const s = samples[i];
          const chunkData = new Uint8Array(this.buffer, s.offset, s.size);
          const chunk = new EncodedVideoChunk({
            type: s.isKey ? 'key' : 'delta',
            timestamp: Math.round(s.pts * 1000000), // microsec
            duration: Math.round(s.duration * 1000000),
            data: chunkData
          });
          this.decoder.decode(chunk);
        }

        this.decoder.flush().then(() => {
          if (this.currentSeekResolve) {
            const res = this.currentSeekResolve;
            this.currentSeekResolve = null;
            this.targetPtsUs = null;
            const fallbackBmp = this.latestSeekBitmap || null;
            this.latestSeekBitmap = null;
            res(fallbackBmp);
          }
        }).catch(() => {
          if (this.currentSeekResolve) {
            const res = this.currentSeekResolve;
            this.currentSeekResolve = null;
            this.targetPtsUs = null;
            res(null);
          }
        });
      } catch (err) {
        this.currentSeekResolve = null;
        this.targetPtsUs = null;
        resolve(null);
      }
    });
  }

  destroy() {
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch (_) {}
      this.decoder = null;
    }
    if (this.latestSeekBitmap) {
      try { this.latestSeekBitmap.close(); } catch (_) {}
      this.latestSeekBitmap = null;
    }
    this.buffer = null;
  }
}

// Worker Message Dispatcher
self.onmessage = async (e) => {
  const data = e.data;
  if (!data) return;

  const { type, id, mediaId } = data;

  if (type === 'init') {
    try {
      const stream = new VideoStream(mediaId, data.buffer);
      if (stream.track && stream.track.samples && stream.track.samples.length > 0) {
        streams.set(mediaId, stream);
        self.postMessage({
          type: 'init_ok',
          id: id,
          mediaId: mediaId,
          duration: stream.track.duration || 0,
          width: stream.track.width || 1920,
          height: stream.track.height || 1080
        });
      } else {
        self.postMessage({ type: 'init_error', id: id, mediaId: mediaId, error: 'No video samples demuxed' });
      }
    } catch (err) {
      self.postMessage({ type: 'init_error', id: id, mediaId: mediaId, error: String(err) });
    }
  } else if (type === 'seek') {
    const stream = streams.get(mediaId);
    if (!stream) {
      self.postMessage({ type: 'seek_result', id: id, mediaId: mediaId, bitmap: null });
      return;
    }

    try {
      const bitmap = await stream.seek(data.timeSec);
      if (bitmap) {
        self.postMessage(
          { type: 'seek_result', id: id, mediaId: mediaId, timeSec: data.timeSec, bitmap: bitmap },
          [bitmap] // Zero-copy Transferable Object
        );
      } else {
        self.postMessage({ type: 'seek_result', id: id, mediaId: mediaId, timeSec: data.timeSec, bitmap: null });
      }
    } catch (_) {
      self.postMessage({ type: 'seek_result', id: id, mediaId: mediaId, timeSec: data.timeSec, bitmap: null });
    }
  } else if (type === 'release') {
    const stream = streams.get(mediaId);
    if (stream) {
      stream.destroy();
      streams.delete(mediaId);
    }
    self.postMessage({ type: 'released', id: id, mediaId: mediaId });
  }
};
