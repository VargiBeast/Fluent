export interface SessionUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface AppEnv {
  Variables: {
    user: SessionUser | undefined;
    sessionId: string | undefined;
    csrfToken: string | undefined;
  };
}
