export const SESSION_COOKIE = 'fk_session';

function baseOptions(env) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
  };
}

export function setSessionCookie(res, token, env) {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(env), maxAge: env.JWT_TTL_SECONDS * 1000 });
}

export function clearSessionCookie(res, env) {
  res.clearCookie(SESSION_COOKIE, baseOptions(env));
}
