/**
 * Pexels API Utility
 *
 * Fetches random background images from Pexels for session backgrounds.
 */

import { createLogger } from './debug.ts';

const log = createLogger('pexels');

interface PexelsPhoto {
  id: number;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
  };
  photographer: string;
  alt: string;
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  total_results: number;
}

/**
 * Fetch a random nature/landscape image from Pexels
 *
 * @param apiKey - Pexels API key
 * @returns URL of the image, or null if fetch fails
 */
export async function fetchRandomPexelsImage(apiKey: string): Promise<string | null> {
  try {
    // Search for nature/landscape images - good for backgrounds
    const query = 'nature landscape';
    const perPage = 80; // Get a good pool to pick from
    const page = Math.floor(Math.random() * 5) + 1; // Random page 1-5 for variety

    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&orientation=landscape`;

    const response = await fetch(url, {
      headers: {
        Authorization: apiKey,
      },
    });

    if (!response.ok) {
      log.error('Pexels API error:', response.status, response.statusText);
      return null;
    }

    const data = (await response.json()) as PexelsSearchResponse;

    if (!data.photos || data.photos.length === 0) {
      log.warn('No photos returned from Pexels');
      return null;
    }

    // Pick a random photo from results
    const randomIndex = Math.floor(Math.random() * data.photos.length);
    const photo = data.photos[randomIndex];

    if (!photo) {
      log.warn('Failed to select photo from Pexels results');
      return null;
    }

    // Use large2x for high quality backgrounds
    log.info(`Selected Pexels image: ${photo.id} by ${photo.photographer}`);
    return photo.src.large2x;
  } catch (error) {
    log.error('Failed to fetch Pexels image:', error);
    return null;
  }
}
