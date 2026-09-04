import { AccountStore } from '../accounts'
const [filePath, accountId, requestId] = process.argv.slice(2)
if (!filePath || !accountId || !requestId) throw new Error('Missing ledger worker arguments')
await new AccountStore({ filePath }).charge(accountId, requestId)
