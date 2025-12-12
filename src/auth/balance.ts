import { getCraftToken, getTeamId } from './craft-token';
import { CraftApi } from '../clients/craftApi';

export async function getAiCreditTopUpUrl(): Promise<string | null> {
  const authToken = await getCraftToken();

  const craftApi = new CraftApi();
  const teamId = await getTeamId();
  if (!teamId) {
    return null;
  }
  const { token } = await craftApi.generateAiCreditCheckoutToken({ authToken, teamId });

  return `https://docs.craft.do/assistant-topup?token=${encodeURIComponent(token)}`;
}

export async function getAiCreditsBalance(): Promise<{ credits: number } | null> {
  const authToken = await getCraftToken();
  const teamId = await getTeamId();
  if (!teamId) {
    return null;
  }
  const craftApi = new CraftApi();
  return craftApi.getAiCreditsBalance({ authToken, teamId });
}
