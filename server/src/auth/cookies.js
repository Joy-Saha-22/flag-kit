export const SESSION_COOKIE = 'fk_session';

function baseOptions(env) {
  const isProduction = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/',
  };
}

export function setSessionCookie(res, token, env) {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(env), maxAge: env.JWT_TTL_SECONDS * 1000 });
}

export function clearSessionCookie(res, env) {
  res.clearCookie(SESSION_COOKIE, baseOptions(env));
}
