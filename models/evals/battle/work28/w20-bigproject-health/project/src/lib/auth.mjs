// Signed in = a session cookie is present (checked properly elsewhere).
export const signedIn = (req) => /(^|;\s*)sid=/.test(req?.headers?.cookie ?? '');
