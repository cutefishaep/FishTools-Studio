const WhammyVideo = (function() {
  function numToBytes(num, bytesCount) {
    const bytes = [];
    for (let i = bytesCount - 1; i >= 0; i--) {
      bytes.push((num >> (i * 8)) & 0xff);
    }
    return new Uint8Array(bytes);
  }

  function numToVarInt(num) {
    let len = 1;
    while (num >= (1 << (7 * len)) - 1 && len < 8) len++;
    const res = new Uint8Array(len);
    let val = num | (1 << (7 * len));
    for (let i = len - 1; i >= 0; i--) {
      res[i] = val & 0xff;
      val >>= 8;
    }
    return res;
  }

  function ebmlElement(id, data) {
    let idBytes;
    if (typeof id === 'number') {
      if (id <= 0xff) idBytes = new Uint8Array([id]);
      else if (id <= 0xffff) idBytes = new Uint8Array([id >> 8, id & 0xff]);
      else if (id <= 0xffffff) idBytes = new Uint8Array([id >> 16, (id >> 8) & 0xff, id & 0xff]);
      else idBytes = new Uint8Array([id >> 24, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
    } else {
      idBytes = id;
    }
    let payload;
    if (typeof data === 'string') {
      payload = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      payload = data;
    } else if (Array.isArray(data)) {
      let totalLen = 0;
      for (let i = 0; i < data.length; i++) totalLen += data[i].length;
      payload = new Uint8Array(totalLen);
      let off = 0;
      for (let i = 0; i < data.length; i++) {
        payload.set(data[i], off);
        off += data[i].length;
      }
    } else {
      payload = new Uint8Array(0);
    }
    const sizeBytes = numToVarInt(payload.length);
    const res = new Uint8Array(idBytes.length + sizeBytes.length + payload.length);
    res.set(idBytes, 0);
    res.set(sizeBytes, idBytes.length);
    res.set(payload, idBytes.length + sizeBytes.length);
    return res;
  }

  function parseWebPToVP8(dataUrl) {
    try {
      const binStr = atob(dataUrl.split(',')[1]);
      const len = binStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
      if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70) {
        let offset = 12;
        while (offset < len - 8) {
          const fourCC = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
          const chunkSize = bytes[offset+4] | (bytes[offset+5] << 8) | (bytes[offset+6] << 16) | (bytes[offset+7] << 24);
          if (fourCC === 'VP8 ') {
            return bytes.subarray(offset + 8, offset + 8 + chunkSize);
          }
          offset += 8 + chunkSize + (chunkSize % 2);
        }
      }
    } catch(e) {}
    return null;
  }

  function toWebM(frames, width, height, fps) {
    const frameDurationMs = 1000 / fps;
    const totalDurationMs = frames.length * frameDurationMs;
    const ebmlHeader = ebmlElement(0x1a45dfa3, [
      ebmlElement(0x4286, new Uint8Array([1])),
      ebmlElement(0x42f7, new Uint8Array([1])),
      ebmlElement(0x42f2, new Uint8Array([4])),
      ebmlElement(0x42f3, new Uint8Array([8])),
      ebmlElement(0x4282, "webm"),
      ebmlElement(0x4287, new Uint8Array([2])),
      ebmlElement(0x4285, new Uint8Array([2]))
    ]);
    const timecodeScale = 1000000;
    const segmentInfo = ebmlElement(0x1549a966, [
      ebmlElement(0x2ad7b1, numToBytes(timecodeScale, 4)),
      ebmlElement(0x4d80, "FishToolStudio"),
      ebmlElement(0x5741, "FishToolStudio"),
      (function() {
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, totalDurationMs, false);
        return ebmlElement(0x4489, new Uint8Array(buf));
      })()
    ]);
    const videoTrack = ebmlElement(0xae, [
      ebmlElement(0xd7, new Uint8Array([1])),
      ebmlElement(0x73c5, new Uint8Array([1])),
      ebmlElement(0x83, new Uint8Array([1])),
      ebmlElement(0x86, "V_VP8"),
      ebmlElement(0xe0, [
        ebmlElement(0xb0, numToBytes(width, 2)),
        ebmlElement(0xba, numToBytes(height, 2))
      ])
    ]);
    const tracks = ebmlElement(0x1654ae6b, [videoTrack]);
    const clusters = [];
    const framesPerCluster = Math.max(1, Math.round(fps * 2));
    for (let c = 0; c < frames.length; c += framesPerCluster) {
      const clusterTimecode = Math.round(c * frameDurationMs);
      const clusterElements = [ebmlElement(0xe7, numToBytes(clusterTimecode, 4))];
      const end = Math.min(frames.length, c + framesPerCluster);
      for (let f = c; f < end; f++) {
        const frameData = frames[f];
        const relTimecode = Math.round((f * frameDurationMs) - clusterTimecode);
        const blockHeader = new Uint8Array([0x81, (relTimecode >> 8) & 0xff, relTimecode & 0xff, 0x80]);
        const block = new Uint8Array(blockHeader.length + frameData.length);
        block.set(blockHeader, 0);
        block.set(frameData, blockHeader.length);
        clusterElements.push(ebmlElement(0xa3, block));
      }
      clusters.push(ebmlElement(0x1f43b675, clusterElements));
    }
    const segment = ebmlElement(0x18538067, [segmentInfo, tracks, ...clusters]);
    return new Blob([ebmlHeader, segment], { type: 'video/webm' });
  }

  return { parseWebPToVP8: parseWebPToVP8, toWebM: toWebM };
})();

window.WhammyVideo = WhammyVideo;
