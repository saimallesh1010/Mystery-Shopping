import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { upsertLead } from '../db/repository';
import { STATE_TIMEZONES } from '../config/settings';

interface CsvRow {
  first_name?: string;
  last_name?: string;
  restaurant_name?: string;           // optional enriched column (not in original sheet)
  organization_website_url?: string;
  email?: string;
  organization_street_address?: string;
  organization_raw_address?: string;
  organization_state?: string;        // may be full name ("Virginia") or abbr ("VA")
  organization_city?: string;
  organization_country?: string;
  organization_postal_code?: string;
  'Google Reviews Count'?: string;
  'Location Phone'?: string;
  'Google Maps Url'?: string;         // actual casing in Google Sheet export
  'Google Maps URL'?: string;         // alternate casing for flexibility
  [key: string]: string | undefined;
}

// Full US state names → 2-letter abbreviation
const STATE_NAME_TO_ABBR: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR',
  CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID',
  ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS',
  KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
  MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
};

function normalizeState(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (upper.length === 2) return upper;                  // already an abbreviation
  return STATE_NAME_TO_ABBR[upper] ?? upper.slice(0, 2); // map full name or best-effort
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export function importCsv(csvPath: string): ImportResult {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const rows: CsvRow[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    // Relax column count mismatches (the sheet has a phantom empty column in some exports)
    relax_column_count: true,
  });

  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    try {
      const phone = normalizePhone(row['Location Phone'] ?? '');
      if (!phone) {
        result.skipped++;
        continue;
      }

      const state = normalizeState(row.organization_state ?? '');
      const city = row.organization_city ?? '';
      const website = row.organization_website_url ?? '';

      // Google Maps URL: sheet exports as "Google Maps Url" (mixed case)
      const mapsUrl =
        row['Google Maps Url'] ?? row['Google Maps URL'] ?? '';

      const lead = upsertLead({
        first_name: row.first_name ?? '',
        last_name: row.last_name ?? '',
        restaurant_name:
          row.restaurant_name?.trim() ||
          extractRestaurantName(website, city, state),
        phone,
        email: row.email ?? '',
        website,
        street_address:
          row.organization_street_address?.trim() ||
          row.organization_raw_address?.trim() || '',
        city,
        state,
        postal_code: row.organization_postal_code ?? '',
        country: row.organization_country ?? 'United States',
        timezone: STATE_TIMEZONES[state] ?? 'America/New_York',
        google_reviews_count:
          parseInt(row['Google Reviews Count'] ?? '0') || 0,
        google_maps_url: mapsUrl,
      });

      // If lead was just created (created_at ≈ updated_at) count as imported else updated
      const isNew =
        Math.abs(
          new Date(lead.created_at).getTime() -
            new Date(lead.updated_at).getTime()
        ) < 2000;

      isNew ? result.imported++ : result.updated++;
    } catch (err) {
      result.errors.push(`Row error: ${(err as Error).message}`);
      result.skipped++;
    }
  }

  return result;
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return '';
}

// Common restaurant-type keywords used to split compound domain names.
// e.g. "marioskitchen" → "Marios Kitchen", "dragonwok" → "Dragon Wok"
const SPLIT_KEYWORDS = [
  'kitchen', 'grill', 'grille', 'bistro', 'cafe', 'restaurant', 'diner',
  'bar', 'pub', 'lounge', 'bbq', 'wok', 'taco', 'pizza', 'burger',
  'chicken', 'shack', 'house', 'corner', 'garden', 'palace', 'inn',
  'tavern', 'place', 'eatery', 'joint', 'spot', 'brew', 'brewery',
];

function extractRestaurantName(
  website: string,
  city: string,
  _state: string
): string {
  if (!website) return `${city} Restaurant`;
  try {
    const url = new URL(
      website.startsWith('http') ? website : `https://${website}`
    );
    const hostname = url.hostname.replace(/^www\./, '');
    let domain = hostname.split('.')[0];

    // Handle explicit separators and camelCase first
    domain = domain
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2');

    // If still a single solid token, try splitting on restaurant keywords
    if (!domain.includes(' ')) {
      const lower = domain.toLowerCase();
      for (const kw of SPLIT_KEYWORDS) {
        const idx = lower.indexOf(kw);
        if (idx > 0) {
          domain = domain.slice(0, idx) + ' ' + domain.slice(idx);
          break;
        }
      }
    }

    const name = domain.replace(/\b\w/g, c => c.toUpperCase()).trim();
    return name || `${city} Restaurant`;
  } catch {
    return `${city} Restaurant`;
  }
}
