import { app, ipcMain } from "electron";
import {EventEmitter} from 'node:events';
import {Socket as UDPSocket, createSocket as createUDPSocket} from 'node:dgram';
import {ChildProcess, spawn} from 'node:child_process';
import * as path from "node:path";

export interface KeyboardEvents {
  keyUp(key: string, vkCode: number): void;
  keyDown(key: string, vkCode: number): void;
}

type EventNameParamMap<T extends object> = {
  [Key in keyof T]: T[Key] extends ((...args: Array<unknown>) => unknown) ? Parameters<T[Key]> : never;
};

const KEYBOARD_HOOK_PATH = './deps/kbhook_app.exe';

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

  private _ensureUdpServer() {
    if(this._server) {
      return;
    }

    this._server = createUDPSocket('udp4', (msg) => {
      /*
        struct {
          uint8_t vkCode{0xFF};
          bool up{true};
        } buffer;
       */
      console.log('Got message', msg);
      const vkCode = msg.readUint8();
      const state = !!msg.readUint8(1);

      const ev = state ? 'keyUp' : 'keyDown';
      this.emit(ev, String(vkCode), vkCode);
    });

    this._serverPort = KeyboardHook._findSafeUDPPort();
    console.log('KeyboardHook server listening on port', this._serverPort);
    this._server.bind(this._serverPort, 'localhost')
  }

  private _osKeyboardHook: ChildProcess | null = null;
  private _ensureOSKeyboardHook() {
    if(this._osKeyboardHook) {
      return;
    }

    const kbHookPath = path.resolve(app.getAppPath(), KEYBOARD_HOOK_PATH);
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

  private static _findSafeUDPPort() {
    const [safePortMin, safePortMax] = [0xC000, 0xFFFF] as const;
    const safePortRange = Math.abs(safePortMax - safePortMin) + 1;
    const wrappedPid = (process.pid + Date.now()) % safePortRange;
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