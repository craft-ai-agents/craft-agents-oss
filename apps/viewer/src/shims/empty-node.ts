
// Browser shim for accidental node built-in imports pulled via @craft-agent/ui → core.
export const userInfo = () => ({ username: 'viewer', uid: 0, gid: 0, shell: '', homedir: '/' })
export const homedir = () => '/'
export const tmpdir = () => '/tmp'
export const platform = () => 'browser'
export const mkdirSync = (..._args: unknown[]) => {}
export const readFileSync = (..._args: unknown[]) => ''
export const writeFileSync = (..._args: unknown[]) => {}
export const renameSync = (..._args: unknown[]) => {}
export const existsSync = (..._args: unknown[]) => false
export const dirname = (p: string) => p
export const join = (...parts: string[]) => parts.join('/')
export const randomUUID = () => crypto.randomUUID()
export default {}
