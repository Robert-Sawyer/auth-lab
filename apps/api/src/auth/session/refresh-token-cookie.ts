export const REFRESH_TOKEN_COOKIE = "refresh_token";

type RefreshTokenCookieOptions = {
  maxAge: number;
  secure: boolean;
};

export function getRefreshTokenCookieOptions({ maxAge, secure }: RefreshTokenCookieOptions) {
  return {
    httpOnly: true,
    maxAge,
    path: "/auth",
    sameSite: "lax" as const,
    secure
  };
}

export function getClearRefreshTokenCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    path: "/auth",
    sameSite: "lax" as const,
    secure
  };
}
