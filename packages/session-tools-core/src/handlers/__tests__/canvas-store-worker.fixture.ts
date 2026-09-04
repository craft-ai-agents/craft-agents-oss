import { CanvasStore } from '../../canvas-store'
const [workspace, session] = process.argv.slice(2)
if (!workspace || !session) throw new Error('Missing test worker arguments')
await new CanvasStore(workspace).enqueue(session, [{ type: 'select_nodes', ids: [] }], undefined, 'p1')
