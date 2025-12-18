import { getCraftToken } from '../auth/craft-token';
import { CraftApi, type ProfileResponse, getTeamIdFromProfile } from '../clients/craftApi';

const FREE_TIER = ['Free', 'free', 'V2_Free', 'v2_free'];
const LIVE_PRICE_ID = 'price_1SdYrjCYYgB1lx2us8igvoy1';

function getSuccessUrl(params: { teamId: string, spaceId: string, go: string }) {
  let result = `https://docs.craft.do`;
  return result;
}

function getSubscriptionPriceId(params: { teamId: string, spaceId: string }) {
  const { teamId, spaceId } = params;
  return {
    priceId: LIVE_PRICE_ID,
    successUrl: getSuccessUrl({ teamId, spaceId, go: 'checkout-success' }),
    cancelUrl: getSuccessUrl({ teamId, spaceId, go: 'checkout-cancel' }),
    environment: 'live' as const,
    country: 'US',
    locale: 'en-US',
  };
}

export async function checkSubscription(profile: ProfileResponse): Promise<string | null> {
  const teamId = getTeamIdFromProfile(profile);
  const team = profile.teams.find(team => team.id === teamId);
  if (!team || !teamId) {
    throw new Error(`Team ${teamId} not found in profile`);
  }
  if (!FREE_TIER.includes(team.tier ?? "free")) {
    return null;
  }
  const space = profile.spaces.find(space => space.teamId === teamId);
  if (!space) {
    throw new Error(`Space for team ${teamId} not found in profile`);
  }
  const { priceId, successUrl, cancelUrl, environment, country, locale } = getSubscriptionPriceId({ teamId, spaceId: space.id });
  const craftApi = new CraftApi();
  const authToken = await getCraftToken();
  try {
    const result = await craftApi.createStripeCheckout({ authToken, priceId, teamId, successUrl, cancelUrl, environment, country, locale });
    return result.checkoutUrl;
  } catch (error) {
    // If team already has an active subscription, proceed without checkout
    if (error instanceof Error && error.message.includes('TEAM_ALREADY_SUBSCRIBED')) {
      return null;
    }
    throw error;
  }
}
