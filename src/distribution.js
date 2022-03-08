'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const util = require('util');
const path = require('path');
const earl = require('@devsnek/earl');
const { DEFAULT_DFLAGS } = require('./flags');

const OpCodes = {
  ALIVE2_REQ: 120,
  ALIVE2_X_RESP: 118,
  ALIVE2_RESP: 121,

  PORT_PLEASE2_REQ: 122,
  PORT2_RESP: 119,

  NAMES_REQ: 110,
  DUMP_REQ: 100,
  KILL_REQ: 107,
  STOP_REQ: 115,
};

const EPMD_PORT = 4369;
const HIDDEN_NODE = 72;
const PROTOCOL = 0;
const LOWEST_VERSION = 5;
const HIGHEST_VERSION = 6;

function frame2(data) {
  const buf = new Uint8Array(2 + data.byteLength);
  new DataView(buf.buffer).setUint16(0, data.byteLength);
  buf.set(data, 2);
  return buf;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const debuglog = util.debuglog('');

const COOKIE = fs.readFileSync(path.join(os.homedir(), '.erlang.cookie'), 'utf8').trim();

function genDigest(cookie, challenge) {
  return crypto.createHash('md5').update(COOKIE + challenge).digest();
}

class EPMDClient {
  constructor(dist) {
    this.dist = dist;

    this.client = net.createConnection({ port: EPMD_PORT }, () => {
      this.alive2();
    });

    this.client.once('error', (e) => dist.emit('error', e));
    this.client.once('close', this.onClose.bind(this));
    this.client.on('data', this.onData.bind(this));
  }

  onClose() {
    // console.log('client close');
  }

  onData(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    switch (data[0]) {
      case OpCodes.ALIVE2_X_RESP:
        this.handleAlive2Resp(
          view.getUint8(1),
          view.getUint32(2),
        );
        break;
      case OpCodes.ALIVE2_RESP:
        this.handleAlive2Resp(
          view.getUint8(1),
          view.getUint16(2),
        );
        break;
      default:
        debuglog('Unknown op', data);
    }
  }

  handleAlive2Resp(result, creation) {
    if (result === 0) {
      this.dist.creation = creation;
    } else {
      throw new Error(`alive2 error: ${result}`);
    }
  }

  alive2() {
    const name = encoder.encode(this.dist.node.name.split('@')[0]);

    const packet = new Uint8Array(
      1 + 2 + 1 + 1 + 2 + 2 + 2 + name.byteLength + 2,
    );

    {
      const view = new DataView(packet.buffer);
      view.setUint8(0, OpCodes.ALIVE2_REQ);
      view.setUint16(1, this.dist.port);
      view.setUint8(3, HIDDEN_NODE);
      view.setUint8(4, PROTOCOL);
      view.setUint16(5, HIGHEST_VERSION);
      view.setUint16(7, LOWEST_VERSION);
      view.setUint16(9, name.byteLength);
      packet.set(name, 11);
    }

    this.client.write(frame2(packet));
  }
}

class NodeConnection {
  constructor(dist, socket, lowestVersion, name) {
    this.dist = dist;
    this.socket = socket;
    this.lowestVersion = lowestVersion;
    this.name = name;
    this.sentName = false;
    this.challenge = crypto.randomBytes(4).readUInt32BE();
    this.hasConnected = false;
    this.heartbeatInterval = undefined;

    socket.on('data', this.onData.bind(this));
    socket.once('close', this.onClose.bind(this));
    socket.once('error', this.onError.bind(this));
  }

  sendName() {
    const name = encoder.encode(this.dist.node.name);

    let data;
    if (this.lowestVersion <= 6) {
      data = new Uint8Array(1 + 8 + 4 + 2 + name.byteLength);
      const view = new DataView(data.buffer);
      view.setUint8(0, 'N'.charCodeAt(0));
      view.setBigUint64(1, BigInt(DEFAULT_DFLAGS));
      view.setUint32(9, this.dist.creation);
      view.setUint16(13, name.byteLength);
      data.set(name, 15);
    } else if (this.lowestVersion <= 5) {
      data = new Uint8Array(1 + 2 + 4 + name.byteLength);
      const view = new DataView(data.buffer);
      view.setUint8(0, 'n'.charCodeAt(0));
      view.setUint16(1, 5);
      view.setUint32(3, DEFAULT_DFLAGS);
      data.set(name, 7);
    } else {
      throw new Error(`unsupported version ${this.lowestVersion}`);
    }

    this.socket.write(frame2(data));

    this.sentName = true;
  }

  onClose() {
    this.cleanup();
  }

  onError(e) {
    this.cleanup();

    if (e.code !== 'ECONNRESET') {
      throw e;
    }
  }

  cleanup() {
    this.dist.nodes.delete(this.name);
    clearInterval(this.heartbeatInterval);
  }

  onData(data) {
    if (this.hasConnected) {
      let start = 0;
      while (true) {
        const length = data.readUInt32BE(start);
        start += 4;
        if (length === 0) {
          break;
        }
        const payload = data.subarray(start, start + length);
        start += length;

        switch (payload[0]) {
          case 'p'.charCodeAt(0): {
            const { value: control, size } = earl.unpack(payload.subarray(1), {
              mapToObject: false,
              atomToString: false,
              returnSize: true,
            });
            const message = payload.subarray(1 + size);
            this.dist.node.handleControlMessage(control, message);
            break;
          }
          default:
            debuglog('Unknown op(4)', payload);
        }

        if (start >= data.length) {
          break;
        }
      }
      return;
    }
    switch (data[2]) {
      case 's'.charCodeAt(0): {
        const status = decoder.decode(data.subarray(3));
        if (status === 'ok') {
          // we good
        } else if (status === 'alive') {
          const packet = new Uint8Array(1 + 2);
          packet[0] = 's'.charCodeAt(0);
          packet.set(encoder.encode('ok'), 1);
          this.socket.write(frame2(packet));
        } else {
          throw new Error(`bad handshake status: ${status}`);
        }
        break;
      }
      case 'n'.charCodeAt(0): {
        if (this.sentName) {
          const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          const flags = view.getUint32(3);
          const challenge = view.getUint32(7);
          const name = decoder.decode(data.subarray(11));
          this.onRecvChallenge(flags, challenge, name, 0);
        } else {
          const name = decoder.decode(data.subarray(9));
          this.onRecvName(name);
        }
        break;
      }
      case 'N'.charCodeAt(0): {
        if (this.sentName) {
          const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          const flags = view.getBigUint64(3);
          const challenge = view.getUint32(11);
          const creation = view.getUint32(15);
          const nameLen = view.getUint16(19);
          const name = decoder.decode(data.subarray(21, 21 + nameLen));
          this.onRecvChallenge(flags, challenge, name, creation);
        } else {
          const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          const nameLen = view.getUint16(15);
          const name = decoder.decode(data.subarray(17, 17 + nameLen));
          this.onRecvName(name);
        }
        break;
      }
      case 'r'.charCodeAt(0): {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const challenge = view.getUint32(3);
        const digest = data.slice(5, 21);
        this.onChallengeReply(challenge, digest);
        break;
      }
      case 'a'.charCodeAt(0): {
        const expected = genDigest(COOKIE, this.challenge);
        const actual = data.slice(3);
        if (Buffer.compare(expected, actual) !== 0) {
          throw new Error('invalid digest');
        }
        this.onConnected();
        break;
      }
      default:
        debuglog('Unknown op(2)', data);
    }
  }

  onRecvName(name) {
    this.name = name;
    this.dist.nodes.set(name, Promise.resolve(this));

    {
      const data = new Uint8Array(1 + 2);
      data[0] = 's'.charCodeAt(0);
      data.set(encoder.encode('ok'), 1);
      this.socket.write(frame2(data));
    }

    {
      // TODO: v5
      const encoded = encoder.encode(this.dist.node.name);

      const data = new Uint8Array(1 + 8 + 4 + 4 + 2 + encoded.byteLength);
      const view = new DataView(data.buffer);

      view.setUint8(0, 'N'.charCodeAt(0));
      view.setBigUint64(1, BigInt(DEFAULT_DFLAGS));
      view.setUint32(9, this.challenge);
      view.setUint32(13, this.dist.creation);
      view.setUint16(17, encoded.byteLength);
      data.set(encoded, 19);

      this.socket.write(frame2(data));
    }
  }

  onRecvChallenge(flags, challenge, _name, _creation) {
    const data = new Uint8Array(1 + 4 + 16);
    const view = new DataView(data.buffer);
    data[0] = 'r'.charCodeAt(0);
    view.setUint32(1, this.challenge);
    data.set(genDigest(COOKIE, challenge), 5);

    this.socket.write(frame2(data));
  }

  onChallengeReply(challenge, digest) {
    if (Buffer.compare(digest, genDigest(COOKIE, this.challenge)) !== 0) {
      // throw new Error('invalid digest');
    }

    const data = new Uint8Array(1 + 16);
    data[0] = 'a'.charCodeAt(0);
    data.set(genDigest(COOKIE, challenge), 1);

    this.socket.write(frame2(data));

    this.onConnected();
  }

  onConnected() {
    this.hasConnected = true;
    this.heartbeatInterval = setInterval(() => {
      this.socket.write(Buffer.from([0, 0, 0, 0]));
    }, 15);
  }

  control(command, message) {
    const head = earl.packTuple(command);

    let tail;
    let tailLength = 0;
    if (message) {
      tail = earl.pack(message);
      tailLength = tail.byteLength;
    }

    const data = new Uint8Array(4 + 1 + head.byteLength + tailLength);
    const view = new DataView(data.buffer);
    view.setUint32(0, 1 + head.byteLength + tailLength);
    view.setUint8(4, 'p'.charCodeAt(0));
    data.set(head, 5);
    if (tail) {
      data.set(tail, 5 + head.byteLength);
    }

    this.socket.write(data);
  }
}

class Distribution {
  constructor(node) {
    this.node = node;

    this.port = null;
    this.client = null;
    this.creation = 0;

    this.nodes = new Map();

    this.server = net.createServer((c) => new NodeConnection(this, c, LOWEST_VERSION));

    this.server.once('error', this.onError.bind(this));
    this.server.once('close', this.onClose.bind(this));

    this.server.listen(0, () => {
      this.port = this.server.address().port;

      this.client = new EPMDClient(this);
    });
  }

  onError(e) {
    console.log('dist error', e);
  }

  onClose() {
    console.log('dist close');
  }

  getNode(descriptor) {
    if (this.nodes.has(descriptor)) {
      return this.nodes.get(descriptor);
    }

    const promise = this.makeNode(descriptor);
    this.nodes.set(descriptor, promise);
    return promise;
  }

  async makeNode(descriptor) {
    const [name, hostname] = descriptor.split('@');

    const encoded = encoder.encode(name);
    const buf = new Uint8Array(1 + encoded.byteLength);
    buf[0] = OpCodes.PORT_PLEASE2_REQ;
    buf.set(encoded, 1);
    const data = frame2(buf);

    const address = hostname === os.hostname() ? '127.0.0.1' : hostname;

    const response = await new Promise((resolve, reject) => {
      const chunks = [];
      const socket = net.createConnection(EPMD_PORT, address, () => {
        socket.write(data);
      });
      socket.on('data', (d) => {
        chunks.push(d);
      });
      socket.once('error', reject);
      socket.once('close', () => {
        resolve(Buffer.concat(chunks));
      });
    });

    if (response[0] !== OpCodes.PORT2_RESP) {
      throw new Error(`unknown opcode ${response[0]}`);
    }
    if (response[1] !== 0) {
      throw new Error(`unknown error ${response[1]}`);
    }
    const view = new DataView(response.buffer, response.byteOffset, response.byteLength);

    const info = {
      hostname: address,
      port: view.getUint16(2),
      nodeType: view.getUint8(4),
      protocol: view.getUint8(5),
      highestVersion: view.getUint16(6),
      lowestVersion: view.getUint16(8),
      name: decoder.decode(response.subarray(12, 12 + view.getUint16(10))),
    };

    const node = new NodeConnection(
      this,
      net.createConnection(info.port, info.hostname),
      info.lowestVersion,
      info.name,
    );
    node.sendName();

    return node;
  }
}

module.exports = { Distribution };
