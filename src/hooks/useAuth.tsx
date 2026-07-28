import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AppUser } from '../types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, role: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

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
      async (_event, session) => {
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
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      // Fallback: try to create profile from auth user metadata
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const meta = user.user_metadata;
        const { data: newProfile, error: insertError } = await supabase
          .from('app_users')
          .upsert({
            id: user.id,
            full_name: meta?.full_name || user.email?.split('@')[0] || 'User',
            email: user.email || '',
            role: meta?.role || 'CS_MANAGER',
          }, { onConflict: 'id' })
          .select('*')
          .single();

        if (!insertError && newProfile) {
          setAppUser(newProfile as AppUser);
        } else {
          console.error('Error creating fallback profile:', insertError);
          setAppUser(null);
        }
      } else {
        setAppUser(null);
      }
    } else {
      setAppUser(data as AppUser);
    }
    setLoading(false);
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }

  async function signUp(email: string, password: string, fullName: string, role: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role,
        },
      },
    });
    if (error) {
      return { error: new Error(error.message || JSON.stringify(error)) };
    }

    // Fallback: ensure app_users row exists (in case trigger didn't fire)
    if (data.user) {
      const { error: profileError } = await supabase
        .from('app_users')
        .upsert({
          id: data.user.id,
          full_name: fullName,
          email: email,
          role: role,
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('Error creating app_users profile:', profileError);
      }
    }

    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setAppUser(null);
  }

  return (
    <AuthContext.Provider value={{ session, user, appUser, loading, signIn, signUp, signOut }}>
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
