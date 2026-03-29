import { app, ipcMain } from "electron";
import {EventEmitter} from 'node:events';
import {Socket as UDPSocket, createSocket as createUDPSocket} from 'node:dgram';
import {ChildProcess, spawn} from 'node:child_process';
import * as path from "node:path";
import winkeymap from '@tomzydev/winkeymap/dist/index.json';

export interface KeyboardEvents {
  keyUp(key: string, vkCode: number): void;
  keyDown(key: string, vkCode: number): void;
}

type EventNameParamMap<T extends object> = {
  [Key in keyof T]: T[Key] extends ((...args: Array<unknown>) => unknown) ? Parameters<T[Key]> : never;
};

const KEYBOARD_HOOK_PATH = './kbhook_app.exe';

export class KeyboardHook extends EventEmitter<EventNameParamMap<KeyboardEvents>>{
  public static readonly instance = new KeyboardHook();

  private _evRegistered = false;

  private constructor() {
    super();

    ipcMain.on("onKeyInput", (ev) => {
      this._ensureUdpServer();
      this._ensureOSKeyboardHook();

      if(!this._evRegistered) {
        this.addListener('keyUp', (key, vkCode) => {
          ev.sender.send('keyInput', { key, vkCode }, 'up');
        });

        this.addListener('keyDown', (key, vkCode) => {
          ev.sender.send('keyInput', { key, vkCode }, 'down')
        });

        this._evRegistered = true;
      }
    })
  }

  private _isSetup = false;
  private _setup() {
    if(this._isSetup) {
      return;
    }


    this._isSetup = true;
  }

  private _server: UDPSocket | null = null;
  private get server() {
    if(!this._server) {
      throw new Error('KeyboardHook UDP server was not set up');
    }

    return this._server!;
  }

  private _serverPort: number | null = null;
  private get serverPort() {
    if(this._serverPort === null) {
      throw new Error('KeyboardHook has invalid UDP server port');
    }

    return this._serverPort!;
  }

  private _ensureUdpServer(maxAttempts = 5) {
    if(this._server) {
      return;
    }

    function onMessage(this: KeyboardHook, msg: Buffer) {
      /*
         struct {
           uint8_t vkCode{0xFF};
           bool up{true};
         } buffer;
        */
      const vkCode = msg.readUint8();
      const state = !!msg.readUint8(1);

      const ev = state ? 'keyUp' : 'keyDown';
      this.emit(ev, KeyboardHook.getKeyName(vkCode), vkCode);
    }

    for(let attempt = 0; !this._server && attempt < maxAttempts; attempt++) {
      try {
        const {safePortRange} = KeyboardHook._getSafeUDPPortRange();
        // If there is an error and we need to re-attempt creating the server, randomise the port as it's possible we're clashing with another service
        const [server, serverPort] = KeyboardHook._createUdpServer(onMessage.bind(this), attempt ? Math.round(Math.random() * safePortRange) : 0);

        this._serverPort = serverPort;
        this._server = server;
      } catch {
        console.log(`KeyboardHook retrying createUdpServer() (failed attempt ${attempt + 1})`);
      }
    }

    console.log('KeyboardHook server listening on port', this._serverPort);
  }

  public static getKeyName(vkCode: number) {
    const hexFallback = `0x${vkCode.toString(16)}` as const;

    if(vkCode in winkeymap) {
      return winkeymap[vkCode as unknown as keyof typeof winkeymap];
    }

    return hexFallback;
  }

  private static _createUdpServer(callback: (msg: Buffer) => void, portOffset = 0) {
    const server = createUDPSocket('udp4', callback);
    const serverPort = KeyboardHook._findSafeUDPPort(portOffset);

    try {
      server.bind(serverPort, 'localhost');
      return [server, serverPort] as const;
    } catch (err) {
      console.error(`KeyboardHook could not create a UDP server on port ${serverPort}:`, err);
      throw err;
    }
  }

  private _osKeyboardHook: ChildProcess | null = null;
  private _ensureOSKeyboardHook() {
    if(this._osKeyboardHook) {
      return;
    }

    const kbHookPath = path.resolve(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'deps'), KEYBOARD_HOOK_PATH);
    this._osKeyboardHook = spawn(kbHookPath, [`${this.serverPort}`]);
    this._osKeyboardHook.stdout.on('data', (data: Buffer) => {
      console.log(data.toString('utf8'));
    });
    console.log('KeyboardHook spawned with', ...this._osKeyboardHook.spawnargs);
  }

  private _cleanupOSKeyboardHook() {
    if(this._osKeyboardHook) {
      this._osKeyboardHook.kill(0);
      this._osKeyboardHook = null;
    }
  }

  private static _getSafeUDPPortRange() {
    const [safePortMin, safePortMax] = [0xC000, 0xFFFF] as const;
    const safePortRange = Math.abs(safePortMax - safePortMin) + 1;
    return {safePortMax, safePortMin, safePortRange};
  }

  private static _findSafeUDPPort(portOffset = 0) {
    const {safePortRange, safePortMax, safePortMin} = this._getSafeUDPPortRange();
    const wrappedPid = (process.pid + Date.now() + portOffset) % safePortRange;
    return Math.min(safePortMin, safePortMax) + wrappedPid;
  }

  private _cleanup() {
    if(!this._isSetup) {
      return;
    }

    this._isSetup = false;

    if(this._server) {
      this._server.close();
      this._server = null;
    }
  }

  public static setup() {
    return this.instance._setup();
  }

  public static cleanup() {
    return this.instance._cleanup();
  }
}