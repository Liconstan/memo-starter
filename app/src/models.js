// The name of a model for the pages, with its version: "Fable 5.1" (memo 1159).
//
// An agent names the model of a helper in one of these forms, and the server stores the short display form:
//   claude-fable-5-1, claude-opus-4-1-20250805   (the full id, with or without a date)
//   fable 5.1, Fable-5.1, fable5.1, fable@5.1     (a name with its version)
//   claude-3-5-sonnet-20241022                    (the older ids, version first)
// A bare alias with no version ("fable", "opus") and any other text stay as given, on one line: the old rows of the
// helpers table keep their look, and a name that is not a Claude model is not changed.
const FAMILY = '(fable|opus|sonnet|haiku)';
// The major and minor numbers have one or two digits, so a date suffix (-20250805) is never read as a minor number.
const FAMILY_FIRST = new RegExp(`^(?:claude[- ])?${FAMILY}[ \\-_@]?(\\d{1,2})(?:[.\\-](\\d{1,2}))?(?:-\\d{8})?$`, 'i');
const VERSION_FIRST = new RegExp(`^claude-(\\d{1,2})(?:-(\\d{1,2}))?-${FAMILY}(?:-\\d{8})?$`, 'i');

export const oneLineModel = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function modelName(value) {
  const text = oneLineModel(value);
  let family, major, minor;
  let m = text.match(FAMILY_FIRST);
  if (m) [, family, major, minor] = m;
  else if ((m = text.match(VERSION_FIRST))) [, major, minor, family] = m;
  else return text;
  return `${family[0].toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor === undefined ? '' : `.${minor}`}`;
}

// True when the name carries a version: "Fable 5.1", "claude-opus-5-5"; false for a bare alias such as "fable".
export const modelVersioned = (value) => /\d/.test(modelName(value));

// For the command line: the version of a model typed as its own word, "fable 5.1" with no quotes. The last word
// is a version (5.1) and the word before it a model family, so the two words together are the model.
export const VERSION_WORD = /^\d{1,2}(?:\.\d{1,2})?$/;
export const FAMILY_WORD = new RegExp(`^(?:claude[- ])?${FAMILY}$`, 'i');
