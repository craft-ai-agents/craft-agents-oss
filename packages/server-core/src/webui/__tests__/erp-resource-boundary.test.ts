import { describe,it,expect } from 'bun:test'
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs'
import { join,resolve,sep } from 'node:path'
import { tmpdir } from 'node:os'
import { materializeAccountSkills,setWorkspaceSkillRoots,loadAllSkills,loadSkillBySlug,type AccountSkillBundle } from '@craft-agent/shared/skills'
import { withoutControlSecrets } from '@craft-agent/shared/agent/control-env'

describe('managed execution resource boundary',()=>{
  it('separates workspace catalogs and removes withdrawn skills without global fallback',()=>{
    const root=mkdtempSync(join(tmpdir(),'erp-skills-test-'))
    try {
      const bundle=(slug:string):AccountSkillBundle=>({skill:{slug,metadata:{name:slug,description:'test'},content:'test',path:slug,visibility:'public',readOnly:true,source:'global'},revision:'fixture',files:[{path:'SKILL.md',base64:Buffer.from(`---\nname: ${slug}\ndescription: fixture\n---\nTest only.`).toString('base64')}]})
      const a=join(root,'a'),b=join(root,'b')
      setWorkspaceSkillRoots(a,materializeAccountSkills({skills:[bundle('only-a')]},join(a,'cache')))
      setWorkspaceSkillRoots(b,materializeAccountSkills({skills:[bundle('only-b')]},join(b,'cache')))
      expect(loadAllSkills(a,b).map(s=>s.slug)).toEqual(['only-a'])
      expect(loadSkillBySlug(a,'only-b',b)).toBeNull()
      expect(loadAllSkills(b).map(s=>s.slug)).toEqual(['only-b'])
      const cached=materializeAccountSkills({skills:[bundle('only-b')]},join(b,'cache'))
      writeFileSync(join(cached.publicRoot,'only-b','SKILL.md'),'tampered fixture')
      expect(()=>materializeAccountSkills({skills:[bundle('only-b')]},join(b,'cache'))).toThrow('已被修改')
      setWorkspaceSkillRoots(a,materializeAccountSkills({skills:[]},join(a,'cache')))
      expect(loadAllSkills(a)).toEqual([])
      expect(loadSkillBySlug(a,'only-a')).toBeNull()
    } finally {
      if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe cleanup')
      rmSync(root,{recursive:true,force:true})
    }
  })
  it('does not pass control-plane secrets to model children',()=>{
    const input={JONWORK_CANVAS_IMAGE_API_KEY:'fixture',JONWORK_CANVAS_TEXT_API_KEY:'fixture',JONWORK_MESHY_API_KEY:'fixture',JONWORK_SSO_API_SECRET:'fixture',JONWORK_SSO_CLIENT_ID:'fixture',CRAFT_SERVER_TOKEN:'fixture',CRAFT_WEBUI_PASSWORD:'fixture',PATH:'test-path',MODEL_PROVIDER_SETTING:'test-value'}
    expect(withoutControlSecrets(input)).toEqual({PATH:'test-path',MODEL_PROVIDER_SETTING:'test-value'})
    expect(input.JONWORK_SSO_API_SECRET).toBe('fixture')
  })
})
