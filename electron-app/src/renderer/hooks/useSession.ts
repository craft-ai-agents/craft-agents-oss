import { atom, useAtom } from 'jotai'

type Config = {
  selected: string | null
}

const configAtom = atom<Config>({
  selected: null,
})

export function useSession() {
  return useAtom(configAtom)
}
