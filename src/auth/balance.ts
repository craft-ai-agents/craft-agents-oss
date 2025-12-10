import { getCraftToken, getTeamId } from './craft-token';
import { CraftApi } from '../clients/craftApi';

export async function getAiCreditTopUpUrl(): Promise<string | null> {
  const authToken = await getCraftToken();

  const craftApi = new CraftApi("https://api.craft.do");
  const teamId = await getTeamId();
  if (!teamId) {
    return null;
  }
  const { token } = await craftApi.generateAiCreditCheckoutToken({ authToken, teamId });

  return `https://docs.craft.do/assistant-topup?token=${encodeURIComponent(token)}`;
}
