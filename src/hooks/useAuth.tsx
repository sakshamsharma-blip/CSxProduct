import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AppUser } from '../types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  isRecoverySession: boolean;
  clearRecoveryState: () => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  changePassword: (newPassword: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecoverySession, setIsRecoverySession] = useState(false);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchAppUser(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Detect password recovery flow
        if (event === 'PASSWORD_RECOVERY') {
          setIsRecoverySession(true);
        }

        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchAppUser(session.user.id);
        } else {
          setAppUser(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function fetchAppUser(userId: string) {
    // First try: direct match by auth user ID (primary email login)
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!error && data) {
      setAppUser(data as AppUser);
      setLoading(false);
      return;
    }

    // Second try: this might be a secondary email login.
    // Look up by email or secondary_email matching the auth user's email.
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      // Try matching primary email
      const { data: byPrimary } = await supabase
        .from('app_users')
        .select('*')
        .eq('email', user.email)
        .single();

      if (byPrimary) {
        setAppUser(byPrimary as AppUser);
        setLoading(false);
        return;
      }

      // Try matching secondary email
      const { data: bySecondary } = await supabase
        .from('app_users')
        .select('*')
        .eq('secondary_email', user.email)
        .single();

      if (bySecondary) {
        setAppUser(bySecondary as AppUser);
        setLoading(false);
        return;
      }

      // No profile found at all — do NOT create a new one.
      // This means the user was not properly invited.
      console.error('No app_users profile found for:', user.email);
      setAppUser(null);
    } else {
      setAppUser(null);
    }
    setLoading(false);
  }

  function clearRecoveryState() {
    setIsRecoverySession(false);
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}`,
    });
    return { error: error as Error | null };
  }

  async function changePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error as Error | null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setAppUser(null);
  }

  return (
    <AuthContext.Provider value={{ session, user, appUser, loading, isRecoverySession, clearRecoveryState, signIn, signOut, resetPassword, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
