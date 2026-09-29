/**
 * Locale options for the profile. The backend accepts `ll` or `ll-CC` (UserUpdate.locale pattern);
 * the list is a convenience — any valid tag already stored on the account is kept selectable.
 */
export const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

const COMMON_LOCALES = [
  "en",
  "en-US",
  "en-GB",
  "en-AU",
  "en-CA",
  "en-IN",
  "bn-BD",
  "hi-IN",
  "ar-SA",
  "de-DE",
  "fr-FR",
  "es-ES",
  "es-MX",
  "it-IT",
  "nl-NL",
  "pt-BR",
  "pt-PT",
  "sv-SE",
  "da-DK",
  "fi-FI",
  "pl-PL",
  "cs-CZ",
  "tr-TR",
  "ru-RU",
  "uk-UA",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
  "id-ID",
  "ms-MY",
  "th-TH",
  "vi-VN",
];

export function localeOptions(current?: string | null): string[] {
  const list = [...COMMON_LOCALES];
  if (current && LOCALE_PATTERN.test(current) && !list.includes(current)) list.unshift(current);
  return list;
}

/** "de-DE" → "German (Germany)"; falls back to the tag itself. */
export function localeLabel(tag: string): string {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(tag) ?? tag;
  } catch {
    return tag;
  }
}
