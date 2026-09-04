import { describe, expect, it } from 'bun:test'
import { assertContextSourceScope } from './context-isolation'

describe('inherited session context boundary',()=>{
  it('accepts only a source in the identical account workspace and project',()=>{
    expect(()=>assertContextSourceScope('alice','project-a',{workspace:{id:'alice'},projectId:'project-a'})).not.toThrow()
  })
  it('rejects other users, other projects, unknown and unbound source contexts',()=>{
    for(const source of [undefined,{workspace:{id:'bob'},projectId:'project-a'},{workspace:{id:'alice'},projectId:'project-b'},{workspace:{id:'alice'}}]) {
      expect(()=>assertContextSourceScope('alice','project-a',source)).toThrow('禁止继承')
    }
    expect(()=>assertContextSourceScope('alice',undefined,{workspace:{id:'alice'}})).toThrow('禁止继承')
  })
})
