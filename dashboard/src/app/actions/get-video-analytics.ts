'use server';

import { unstable_cache } from 'next/cache';
import {
  getVideoCountries,
  getVideoAgeGender,
  getVideoRetention,
  getVideoTrafficSources,
  YouTubeScopeError,
  type CountryViewShare,
  type AgeGenderShare,
  type RetentionPoint,
  type TrafficSourceShare,
} from '@/lib/youtube';

export interface VideoAnalyticsBundle {
  countries: CountryViewShare[];
  ageGender: AgeGenderShare[];
  retention: RetentionPoint[];
  trafficSources: TrafficSourceShare[];
  /** Surfaced when getAccessToken finds no scope — caller can prompt
   *  reconnect inline rather than rendering empty panels. */
  needsReconsent: boolean;
  /** Non-scope failure (channel not eligible, quota, transient outage).
   *  Caller renders the message in a small banner inside the expanded
   *  drawer so the user knows why panels are empty. */
  loadError: string | null;
}

/**
 * Loads all four per-video analytics dimensions in parallel, cached
 * for 1 hour per videoId. The cache key includes videoId so each
 * video gets its own slot — refreshing the page or expanding many
 * cards in a session won't multiply quota cost.
 *
 * 1h is short enough that the user sees recent traffic, long enough
 * that re-clicking the same row 5 times in a debugging session costs
 * one set of API calls instead of five. The Analytics API has a
 * ~24h freshness anyway, so faster cache wouldn't help.
 */
const loadCached = unstable_cache(
  async (videoId: string): Promise<VideoAnalyticsBundle> => {
    try {
      const [countries, ageGender, retention, trafficSources] = await Promise.all([
        getVideoCountries(videoId),
        getVideoAgeGender(videoId),
        getVideoRetention(videoId),
        getVideoTrafficSources(videoId),
      ]);
      return {
        countries, ageGender, retention, trafficSources,
        needsReconsent: false, loadError: null,
      };
    } catch (e) {
      if (e instanceof YouTubeScopeError) {
        return {
          countries: [], ageGender: [], retention: [], trafficSources: [],
          needsReconsent: true, loadError: null,
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[get-video-analytics] ${videoId} non-scope error:`, e);
      return {
        countries: [], ageGender: [], retention: [], trafficSources: [],
        needsReconsent: false, loadError: msg,
      };
    }
  },
  ['video-analytics'],
  { revalidate: 60 * 60, tags: ['video-analytics'] },
);

export async function getVideoAnalytics(
  videoId: string,
): Promise<VideoAnalyticsBundle> {
  return loadCached(videoId);
}
