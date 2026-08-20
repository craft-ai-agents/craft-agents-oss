/**
 * Build-time stand-ins for Node built-ins reachable through shared server code.
 *
 * The renderer must use `window.electronAPI` for host work. These exports only
 * keep accidental server-only imports from making the browser bundle invalid;
 * they are deliberately inert rather than Node polyfills. Buffer and process
 * are the two browser-compatible exceptions used by transitive dependencies.
 */
import { Buffer as BrowserBuffer } from 'buffer'
import browserProcess from 'process'

type StubFn = (...args: unknown[]) => undefined

type StubStream = {
  on: () => StubStream
  once: () => StubStream
  pipe: StubFn
  write: StubFn
  end: StubFn
  listen: () => StubStream
  close: StubFn
  kill: StubFn
  stdout: { on: () => StubStream }
  stderr: { on: () => StubStream }
  stdin: { write: StubFn; end: StubFn }
}

const fn: StubFn = (..._args) => undefined
const obj = (): StubStream => ({
  on: () => obj(),
  once: () => obj(),
  pipe: fn,
  write: fn,
  end: fn,
  listen: () => obj(),
  close: fn,
  kill: fn,
  stdout: { on: () => obj() },
  stderr: { on: () => obj() },
  stdin: { write: fn, end: fn },
})
const hash = () => {
  const value = {
    update: () => value,
    digest: () => BrowserBuffer.alloc(0),
    setAAD: () => value,
    setAuthTag: () => value,
    getAuthTag: () => BrowserBuffer.alloc(0),
    final: () => BrowserBuffer.alloc(0),
  }
  return value
}
const dynamic = new Proxy<Record<string, StubFn>>({}, { get: () => fn })
const pathLike = (...parts: unknown[]) => (
  typeof parts[0] === 'string' ? parts.filter(Boolean).join('/') : ''
)
const binaryOrEmpty = (...args: unknown[]) => (
  typeof args[0] === 'number' ? BrowserBuffer.alloc(args[0]) : ''
)

export const Buffer = BrowserBuffer
export const EOL = '/'
export const EventEmitter = fn as never
export const PassThrough = fn as never
export const Readable = fn as never
export const Server = (..._args: unknown[]) => obj()
export const Socket = (..._args: unknown[]) => obj()
export const Stream = fn as never
export const TextDecoder = fn as never
export const TextEncoder = fn as never
export const Transform = fn as never
export const URL = fn as never
export const URLSearchParams = fn as never
export const Writable = fn as never
export const access = fn
export const accessSync = binaryOrEmpty
export const appendFile = fn
export const appendFileSync = binaryOrEmpty
export const arch = () => 'arm64'
export const argv = fn as never
export const basename = pathLike
export const chdir = fn
export const closeSync = binaryOrEmpty
export const connect = (..._args: unknown[]) => obj()
export const constants = dynamic
export const constants_fs = dynamic
export const copyFile = fn
export const copyFileSync = binaryOrEmpty
export const cpus = fn
export const createCipheriv = (..._args: unknown[]) => hash()
export const createConnection = (..._args: unknown[]) => obj()
export const createDecipheriv = (..._args: unknown[]) => hash()
export const createHash = (..._args: unknown[]) => hash()
export const createHmac = (..._args: unknown[]) => hash()
export const createPrivateKey = binaryOrEmpty
export const createPublicKey = binaryOrEmpty
export const createReadStream = (..._args: unknown[]) => obj()
export const createServer = (..._args: unknown[]) => obj()
export const createWriteStream = (..._args: unknown[]) => obj()
export const cwd = fn as never
export const debuglog = fn
export const delimiter = '/'
export const deprecate = fn
export const dirname = pathLike
export const endianness = fn
export const env = fn as never
export const exec = binaryOrEmpty
export const execFile = binaryOrEmpty
export const execFileSync = binaryOrEmpty
export const execSync = binaryOrEmpty
export const existsSync = () => false
export const exit = fn
export const extname = fn
export const fileURLToPath = fn
export const fork = (..._args: unknown[]) => obj()
export const format = fn
export const freemem = fn
export const generateKeyPairSync = binaryOrEmpty
export const get = (..._args: unknown[]) => obj()
export const getRandomValues = fn
export const homedir = () => '/'
export const hostname = () => 'localhost'
export const inherits = fn
export const inspect = fn
export const isAbsolute = fn
export const join = pathLike
export const lstat = fn
export const lstatSync = binaryOrEmpty
export const mkdir = fn
export const mkdirSync = binaryOrEmpty
export const mkdtemp = fn
export const mkdtempSync = binaryOrEmpty
export const networkInterfaces = fn
export const nextTick = fn
export const normalize = pathLike
export const open = fn
export const openSync = binaryOrEmpty
export const parse = fn
export const pathToFileURL = fn
export const pbkdf2Sync = binaryOrEmpty
export const pid = fn as never
export const platform = () => 'darwin'
export const posix = dynamic
export const ppid = fn as never
export const privateDecrypt = binaryOrEmpty
export const process = browserProcess
export const promises = dynamic
export const promisify = fn
export const publicEncrypt = binaryOrEmpty
export const randomBytes = fn
export const randomFillSync = binaryOrEmpty
export const randomUUID = fn
export const readFile = (...args: unknown[]) => (
  args.length > 0 && typeof args[0] === 'string' ? '' : Promise.resolve('')
)
export const readFileSync = () => ''
export const readSync = binaryOrEmpty
export const readdir = fn
export const readdirSync = binaryOrEmpty
export const realpath = fn
export const realpathSync = binaryOrEmpty
export const relative = pathLike
export const release = fn
export const rename = fn
export const renameSync = binaryOrEmpty
export const request = (..._args: unknown[]) => obj()
export const resolve = pathLike
export const rm = fn
export const rmSync = binaryOrEmpty
export const scryptSync = binaryOrEmpty
export const sep = '/'
export const sign = binaryOrEmpty
export const spawn = (..._args: unknown[]) => obj()
export const spawnSync = (..._args: unknown[]) => obj()
export const stat = fn
export const statSync = binaryOrEmpty
export const title = fn
export const tmpdir = () => '/'
export const totalmem = fn
export const type = fn
export const types = dynamic
export const unlink = fn
export const unlinkSync = binaryOrEmpty
export const uptime = fn
export const userInfo = () => ({ username: 'renderer', uid: 0, gid: 0, shell: '', homedir: '/' })
export const verify = binaryOrEmpty
export const version = fn
export const versions = fn
export const win32 = dynamic
export const writeFile = fn
export const writeFileSync = binaryOrEmpty
export const writeSync = binaryOrEmpty

export default {}
