import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Scale, 
  Plus, 
  Minus, 
  Table as TableIcon, 
  Target, 
  AlertCircle, 
  Loader2, 
  Send,
  RefreshCw,
  Trophy,
  Brain,
  History,
  Trash2,
  ChevronRight,
  Clock,
  X,
  Share2,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc,
  limit
} from 'firebase/firestore';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  OperationType, 
  handleFirestoreError,
  serverTimestamp 
} from './lib/firebase';

// --- Types ---

type AnalysisType = 'pros_cons' | 'comparison' | 'swot';

interface DecisionAnalysis {
  verdict?: string;
  reasoning?: string;
  pros_cons?: {
    pros: string[];
    cons: string[];
  };
  comparison?: {
    headers: string[];
    rows: string[][];
  };
  swot?: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  clarifying_questions?: string[]; // AI can ask these if context is missing
}

interface HistoryItem {
  id: string;
  timestamp: number;
  decision: string;
  analysis: DecisionAnalysis;
  userAnswers?: Record<string, string>;
}

// --- AI Setup ---

const API_KEY = process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;

if (!API_KEY) {
  console.warn("Gemini API Key missing. Please set GEMINI_API_KEY (AI Studio) or VITE_GEMINI_API_KEY (.env)");
}

const ai = new GoogleGenAI({ apiKey: API_KEY! });

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    clarifying_questions: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "If the decision is too vague or needs personal context (health, budget, goals) to be accurate, list 2-3 specific questions here. Leave empty if you have enough info."
    },
    verdict: { type: Type.STRING, description: "A one-sentence decisive recommendation. Only provide if clarifying_questions is empty." },
    reasoning: { type: Type.STRING, description: "Extended explanation for the verdict. Only provide if clarifying_questions is empty." },
    pros_cons: {
      type: Type.OBJECT,
      properties: {
        pros: { type: Type.ARRAY, items: { type: Type.STRING } },
        cons: { type: Type.ARRAY, items: { type: Type.STRING } }
      }
    },
    comparison: {
      type: Type.OBJECT,
      properties: {
        headers: { type: Type.ARRAY, items: { type: Type.STRING } },
        rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } }
      }
    },
    swot: {
      type: Type.OBJECT,
      properties: {
        strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
        weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
        opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
        threats: { type: Type.ARRAY, items: { type: Type.STRING } }
      }
    }
  }
};

const getRelativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 30) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
};

// --- App Component ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [decision, setDecision] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<DecisionAnalysis | null>(null);
  const [activeTab, setActiveTab] = useState<AnalysisType>('pros_cons');
  const [error, setError] = useState<{ title: string; message: string; action?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  
  // Interactive Questioning State
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});

  // States for Firestore data
  const [personalProfile, setPersonalProfile] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Fetch Profile and History from Firestore
  useEffect(() => {
    if (!currentUser) {
      setPersonalProfile('');
      setHistory([]);
      return;
    }

    // Subscribe to History
    const historyPath = `users/${currentUser.uid}/history`;
    const q = query(
      collection(db, historyPath),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribeHistory = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
      })) as HistoryItem[];
      setHistory(items);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, historyPath);
    });

    // Fetch Profile
    const profilePath = `users/${currentUser.uid}`;
    const fetchProfile = async () => {
      try {
        const docRef = doc(db, profilePath);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPersonalProfile(docSnap.data().personalProfile);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, profilePath);
      }
    };
    fetchProfile();

    return () => unsubscribeHistory();
  }, [currentUser]);

  // Sync profile changes to Firestore (Debounced or on blur would be better, but let's do a save helper)
  const saveProfile = async (profileText: string) => {
    if (!currentUser) return;
    const path = `users/${currentUser.uid}`;
    try {
      await setDoc(doc(db, path), {
        personalProfile: profileText,
        email: currentUser.email,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp() // setDoc will overwrite, rules handle immutability via diff() if we use updateDoc, but setDoc with merge: true is better if we want to ensure existence
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const [thread, setThread] = useState<{ question: string; analysis: DecisionAnalysis }[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [showShareCopy, setShowShareCopy] = useState(false);

  const copyShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareCopy(true);
    setTimeout(() => setShowShareCopy(false), 2000);
  };

  const analyzeDecision = async (answers?: Record<string, string>, followUpQuestion?: string) => {
    if (!decision.trim() && !followUpQuestion) return;
    
    setIsAnalyzing(true);
    setError(null);

    const contextStr = personalProfile ? `User Profile/Context: ${personalProfile}` : 'No specific user profile provided.';
    const answersStr = answers ? `User responses to your previous questions: ${JSON.stringify(answers)}` : '';
    const threadStr = thread.length > 0 
      ? `Previous steps in this decision thread:\n${thread.map((t, i) => `Step ${i+1}: Q: ${t.question} | Verdict: ${t.analysis.verdict}`).join('\n')}`
      : '';

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: followUpQuestion 
          ? `The user is refining their decision. 
             Initial Decision: "${decision}"
             ${threadStr}
             Follow-up Question: "${followUpQuestion}"
             
             ${contextStr}
             
             Analyze this follow-up. Provide a new verdict, reasoning, and analysis based on this specific refinement. 
             If you need more personal context for this refinement, ask 1-2 clarifying questions.`
          : `Analyze this decision: "${decision}". 
             ${contextStr}
             ${answersStr}
 
             CRITICAL: If the decision depends heavily on health, finances, or personal constraints that the user hasn't specified in the decision or profile, use the 'clarifying_questions' field to ask for that missing info. DO NOT give a verdict if you are guessing about critical personal context.
             
             If you have enough information, provide a detailed analysis including Pros/Cons, a comparison table, and a SWOT analysis. 
             Be the ultimate tie breaker.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA as any
        }
      });

      const text = response.text;
      if (!text) throw new Error("EMPTY_RESPONSE");

      const data = JSON.parse(text);
      setResult(data);
      
      // If it's a follow-up, add to thread
      if (followUpQuestion && data.verdict) {
        setThread(prev => [...prev, { question: followUpQuestion, analysis: data }]);
        setFollowUp('');
      } else if (!followUpQuestion && data.verdict) {
        // Initial decision
        setThread([{ question: decision, analysis: data }]);
      }

      // If it's a final verdict, save to history
      if (data.verdict && currentUser) {
        const id = crypto.randomUUID();
        const historyPath = `users/${currentUser.uid}/history/${id}`;
        const newHistoryItem = {
          decision: followUpQuestion ? `${decision} (Refinement: ${followUpQuestion})` : decision,
          analysis: data,
          userAnswers: answers || null,
          timestamp: Date.now(),
          userId: currentUser.uid,
          createdAt: serverTimestamp()
        };

        try {
          await setDoc(doc(db, historyPath), newHistoryItem);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, historyPath);
        }
        
        if (data.comparison) setActiveTab('comparison');
        else if (data.swot) setActiveTab('swot');
        else setActiveTab('pros_cons');
      }

    } catch (err: any) {
      console.error("Analysis Error:", err);
      const message = err.message?.toUpperCase() || "";
      
      let errorDetails = {
        title: "Analysis Failed",
        message: "Something went wrong while processing your decision.",
        action: "Please try again in a few moments."
      };

      if (message.includes("SAFETY") || message.includes("BLOCKED")) {
        errorDetails = {
          title: "Safety Shield",
          message: "This decision involves topics that trigger AI safety filters.",
          action: "Try rephrasing your prompt to be more neutral or less sensitive."
        };
      } else if (message.includes("QUOTA") || message.includes("RATE_LIMIT") || message.includes("429")) {
        errorDetails = {
          title: "Rate Limit Reached",
          message: "You've sent too many requests in a short time.",
          action: "Wait about 60 seconds before trying to break the tie again."
        };
      } else if (message.includes("EMPTY_RESPONSE")) {
        errorDetails = {
          title: "Vague Input",
          message: "The AI couldn't extract a clear decision from your input.",
          action: "Try being more specific about the choices you are weighing."
        };
      } else if (message.includes("API_KEY") || message.includes("403")) {
        errorDetails = {
          title: "Configuration Error",
          message: "The API key appears to be missing or invalid.",
          action: "Ensure GEMINI_API_KEY is set correctly in the Secrets panel."
        };
      } else if (message.includes("NETWORK") || message.includes("FETCH") || err.name === "TypeError") {
        errorDetails = {
          title: "Connection Lost",
          message: "Could not reach the AI servers.",
          action: "Check your internet connection and try again."
        };
      } else if (err instanceof SyntaxError) {
        errorDetails = {
          title: "Formatting Error",
          message: "The AI's response was garbled or incomplete.",
          action: "Try a shorter, more direct decision prompt."
        };
      }

      setError(errorDetails);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setDecision(item.decision);
    setResult(item.analysis);
    setThread([{ question: item.decision, analysis: item.analysis }]);
    setShowHistory(false);
    
    if (item.analysis.comparison) setActiveTab('comparison');
    else if (item.analysis.swot) setActiveTab('swot');
    else setActiveTab('pros_cons');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;
    const path = `users/${currentUser.uid}/history/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const clearHistory = async () => {
    if (confirm('Are you sure you want to clear all history? This will delete all your records from the database.')) {
      // For a real app, you'd batch delete or have a cloud function.
      // Here, we'll delete them one by one for simplicity as it's limited to 50.
      for (const item of history) {
        const path = `users/${currentUser?.uid}/history/${item.id}`;
        try {
          await deleteDoc(doc(db, path));
        } catch (err) {
          console.error("Failed to delete", item.id);
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1115] text-[#E0E0E0] font-sans selection:bg-[#FF4E00] selection:text-white flex flex-col md:flex-row overflow-x-hidden">
      {/* Abstract Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#FF4E00] opacity-[0.03] blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#4E00FF] opacity-[0.03] blur-[120px] rounded-full" />
      </div>

      {/* History Sidebar - Desktop */}
      <aside className={`
        fixed md:relative z-40 bg-[#121418] border-r border-[#ffffff05] h-screen transition-all duration-500 ease-in-out
        ${showHistory ? 'w-80 translate-x-0' : 'w-0 -translate-x-full md:w-16 md:translate-x-0'}
        flex flex-col shadow-2xl
      `}>
        <div className={`p-4 flex items-center justify-between border-b border-[#ffffff05] ${!showHistory && 'hidden md:flex flex-col justify-start'}`}>
          {showHistory ? (
            <>
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-[#FF4E00]" />
                <span className="text-sm font-mono uppercase tracking-widest">Workspace</span>
              </div>
              <button 
                onClick={() => setShowHistory(false)}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                title="Close sidebar"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
            </>
          ) : (
            <button 
              onClick={() => setShowHistory(true)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors mt-2"
              title="Open sidebar"
            >
              <History className="w-6 h-6 text-[#8E9299] hover:text-[#FF4E00] transition-colors" />
            </button>
          )}
        </div>

        <div className={`flex-1 overflow-y-auto custom-scrollbar ${!showHistory && 'hidden'}`}>
          {/* User Profile */}
          <div className="p-4 border-b border-[#ffffff05]">
            {isAuthLoading ? (
              <div className="flex items-center justify-center py-2 h-10">
                <Loader2 className="w-4 h-4 animate-spin text-[#8E9299]" />
              </div>
            ) : currentUser ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  {currentUser.photoURL ? (
                    <img src={currentUser.photoURL} alt="" className="w-8 h-8 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                      <UserIcon className="w-4 h-4 text-[#8E9299]" />
                    </div>
                  )}
                  <div className="text-left min-w-0">
                    <p className="text-xs font-medium text-white truncate">{currentUser.displayName || 'User'}</p>
                    <button 
                      onClick={() => logout()} 
                      className="text-[10px] text-[#FF4E00] hover:underline flex items-center gap-1"
                    >
                      <LogOut className="w-2.5 h-2.5" />
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => loginWithGoogle()}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white text-black rounded-xl text-[10px] font-bold hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                Login for Private History
              </button>
            )}
          </div>

          {/* Personal Profile Section */}
          <div className="p-4 border-b border-[#ffffff05]">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#4A4D54]">Your Context</h4>
              {currentUser && personalProfile && (
                <button 
                  onClick={() => saveProfile(personalProfile)}
                  className="text-[9px] font-mono uppercase tracking-widest text-[#FF4E00] hover:text-white transition-colors"
                >
                  Save
                </button>
              )}
            </div>
            <textarea
              value={personalProfile}
              onChange={(e) => setPersonalProfile(e.target.value)}
              disabled={!currentUser}
              placeholder={currentUser ? "e.g. Allergies, budget constraints, risk tolerance..." : "Please login to set your personal context profile."}
              className="w-full bg-[#1A1C21] border border-[#ffffff05] rounded-xl p-3 text-xs text-[#8E9299] focus:text-white transition-colors focus:ring-1 focus:ring-[#FF4E00] resize-none h-24 disabled:opacity-30 disabled:cursor-not-allowed"
            />
            <p className="text-[9px] text-[#4A4D54] mt-2 italic">This context is used to tailor AI advice specifically to you.</p>
          </div>

          <div className="p-4">
            <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#4A4D54] mb-3">Recent Decisions</h4>
            {history.length === 0 ? (
              <div className="py-8 text-center text-[#4A4D54]">
                <History className="w-8 h-8 mx-auto mb-2 opacity-10" />
                <p className="text-[10px] font-mono uppercase tracking-widest">Empty</p>
              </div>
            ) : (
              <div className="space-y-1">
                {history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => loadHistoryItem(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && loadHistoryItem(item)}
                    className="w-full text-left p-3 rounded-xl hover:bg-white/[0.03] group transition-all relative overflow-hidden flex flex-col gap-1 active:scale-[0.98] cursor-pointer"
                  >
                    <span className="text-sm text-[#E0E0E0] truncate line-clamp-1 pr-6">{item.decision}</span>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-[#4A4D54] flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {getRelativeTime(item.timestamp)}
                      </span>
                      <button 
                        onClick={(e) => deleteHistoryItem(item.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:text-red-400 text-[#4A4D54] transition-all absolute top-2 right-2"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {showHistory && history.length > 0 && (
          <div className="p-4 border-t border-[#ffffff05]">
            <button 
              onClick={clearHistory}
              className="w-full py-2 text-[10px] font-mono uppercase tracking-widest text-[#4A4D54] hover:text-red-400 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="w-3 h-3" />
              Clear History
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 w-full">
        {/* Mobile History Toggle */}
        <div className="md:hidden flex justify-end p-4">
          <button 
            onClick={() => setShowHistory(true)}
            className="p-3 bg-white/5 border border-white/10 rounded-xl"
          >
            <History className="w-5 h-5 text-[#8E9299]" />
          </button>
        </div>

        <div className="max-w-4xl mx-auto px-6 py-12 lg:py-20">
          <header className="mb-12 text-center">
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#ffffff10] bg-[#ffffff05] mb-4 relative"
            >
              <Scale className="w-4 h-4 text-[#FF4E00]" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8E9299]">The Ultimate Tie Breaker</span>
              <button 
                onClick={copyShareLink}
                className="ml-2 pl-2 border-l border-white/10 text-[10px] font-mono uppercase tracking-widest text-[#FF4E00] hover:text-white transition-colors flex items-center gap-1"
              >
                <Share2 className="w-3 h-3" />
                {showShareCopy ? 'Copied' : 'Share'}
              </button>
            </motion.div>
            <motion.h1 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl lg:text-7xl font-light tracking-tight mb-4 bg-gradient-to-b from-white to-[#ffffff60] bg-clip-text text-transparent"
            >
              Make the <span className="italic font-serif">Right</span> Move
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-[#8E9299] max-w-md mx-auto"
            >
              Describe your decision or dilemma. Let AI dissect the variables and guide your next step.
            </motion.p>
          </header>

          {/* Input Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="relative group mb-12"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-[#FF4E00] to-[#4E00FF] rounded-2xl blur opacity-10 group-hover:opacity-20 transition duration-500" />
            <div className="relative bg-[#151619] border border-[#ffffff10] rounded-2xl p-2 shadow-2xl">
              <textarea
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
                placeholder="e.g. Should I quit my job to start a bakery in France?"
                className="w-full bg-transparent border-none focus:ring-0 resize-none text-xl lg:text-2xl p-6 min-h-[160px] placeholder-[#ffffff20] leading-relaxed"
                autoFocus
              />
              <div className="flex items-center justify-between p-4 border-t border-[#ffffff05]">
                <div className="flex gap-2 text-[#8E9299] text-xs font-mono">
                  <Brain className="w-4 h-4" />
                  <span>Powered by Gemini 2.0 Flash</span>
                </div>
                <button 
                  onClick={() => analyzeDecision()}
                  disabled={isAnalyzing || !decision.trim()}
                  className="group relative inline-flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl font-medium transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Analyzing...</span>
                    </>
                  ) : (
                    <>
                      <span>Break the Tie</span>
                      <Send className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6 mb-8 flex items-start gap-4"
            >
              <div className="bg-red-500/10 p-2 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider">{error.title}</h3>
                <p className="text-white/80 text-sm leading-relaxed">{error.message}</p>
                {error.action && (
                  <p className="text-[#8E9299] text-[10px] font-mono mt-2 flex items-center gap-2">
                    <span className="text-red-500/50">→</span> {error.action}
                  </p>
                )}
              </div>
              <button 
                onClick={() => setError(null)}
                className="ml-auto p-1 hover:bg-white/5 rounded-lg transition-colors group"
              >
                <X className="w-4 h-4 text-[#8E9299] group-hover:text-white" />
              </button>
            </motion.div>
          )}

          {/* Results Section */}
          <AnimatePresence mode="wait">
            {result && (
              <motion.div
                key="result"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-8"
              >
                {/* Clarifying Questions */}
                {result.clarifying_questions && result.clarifying_questions.length > 0 && !result.verdict && (
                  <div className="bg-[#1C1D21] border border-[#FF4E00]/20 rounded-2xl p-8 relative overflow-hidden">
                    <div className="relative space-y-6">
                      <div className="flex items-center gap-3">
                        <div className="bg-[#FF4E00]/10 p-2 rounded-lg">
                          <Brain className="w-5 h-5 text-[#FF4E00]" />
                        </div>
                        <div>
                          <h3 className="text-sm font-mono uppercase tracking-widest text-[#FF4E00]">Context Needed</h3>
                          <p className="text-[#8E9299] text-xs mt-1">To give the best advice, I need to know a bit more:</p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        {result.clarifying_questions.map((q, i) => (
                          <div key={i} className="space-y-2">
                            <label className="text-sm text-white block font-medium">{q}</label>
                            <input
                              type="text"
                              value={userAnswers[q] || ''}
                              onChange={(e) => setUserAnswers(prev => ({ ...prev, [q]: e.target.value }))}
                              placeholder="Type your answer..."
                              className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-[#FF4E00] transition-all"
                            />
                          </div>
                        ))}
                      </div>

                      <button 
                        onClick={() => analyzeDecision(userAnswers)}
                        disabled={isAnalyzing || result.clarifying_questions.some(q => !userAnswers[q]?.trim())}
                        className="w-full bg-white text-black py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50"
                      >
                        {isAnalyzing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Recalculating...</span>
                          </>
                        ) : (
                          <>
                            <span>Finalize Decision</span>
                            <ChevronRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Verdict Card */}
                {result.verdict && (
                  <>
                    {/* Thread Path */}
                    {thread.length > 1 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {thread.slice(0, -1).map((t, i) => (
                          <div key={i} className="flex items-center gap-2">
                             <div className="text-[10px] font-mono text-[#4A4D54] px-2 py-1 bg-white/5 rounded border border-white/5 max-w-[150px] truncate">
                               {t.question}
                             </div>
                             <ChevronRight className="w-3 h-3 text-[#4A4D54]" />
                          </div>
                        ))}
                        <div className="text-[10px] font-mono text-[#FF4E00] px-2 py-1 bg-[#FF4E00]/5 rounded border border-[#FF4E00]/20">
                          Current Focus
                        </div>
                      </div>
                    )}

                    <div className="bg-[#1C1D21] border border-[#ffffff10] rounded-2xl p-8 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-[0.03]">
                    <Trophy className="w-48 h-48 rotate-12" />
                  </div>
                  <div className="relative flex flex-col md:flex-row gap-8 items-start">
                    <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                      <Trophy className="w-8 h-8 text-[#FF4E00]" />
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-sm font-mono uppercase tracking-widest text-[#FF4E00]">AI Verdict</h3>
                      <p className="text-3xl lg:text-4xl font-light tracking-tight text-white leading-tight">
                        {result.verdict}
                      </p>
                      <p className="text-[#8E9299] text-lg leading-relaxed">
                        {result.reasoning}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex bg-[#151619] border border-[#ffffff10] p-1.5 rounded-2xl w-fit mx-auto overflow-hidden">
                  <TabButton 
                    active={activeTab === 'pros_cons'} 
                    onClick={() => setActiveTab('pros_cons')}
                    icon={<Scale className="w-4 h-4" />}
                    label="Pros & Cons"
                  />
                  {result.comparison && (
                    <TabButton 
                      active={activeTab === 'comparison'} 
                      onClick={() => setActiveTab('comparison')}
                      icon={<TableIcon className="w-4 h-4" />}
                      label="Comparison Table"
                    />
                  )}
                  {result.swot && (
                    <TabButton 
                      active={activeTab === 'swot'} 
                      onClick={() => setActiveTab('swot')}
                      icon={<Target className="w-4 h-4" />}
                      label="SWOT Analysis"
                    />
                  )}
                </div>

                {/* Analysis Content */}
                <motion.div 
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="min-h-[400px]"
                >
                  {activeTab === 'pros_cons' && result.pros_cons && (
                    <div className="grid md:grid-cols-2 gap-6">
                      <ProsConsSection title="Pros" items={result.pros_cons.pros} type="pro" />
                      <ProsConsSection title="Cons" items={result.pros_cons.cons} type="con" />
                    </div>
                  )}

                  {activeTab === 'comparison' && result.comparison && (
                    <div className="bg-[#151619] border border-[#ffffff10] rounded-2xl overflow-hidden shadow-xl">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-[#ffffff10] bg-white/[0.02]">
                              {result.comparison.headers.map((h, i) => (
                                <th key={i} className="p-6 text-xs font-mono uppercase tracking-widest text-[#8E9299]">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {result.comparison.rows.map((row, i) => (
                              <tr key={i} className="border-b border-[#ffffff05] hover:bg-white/[0.01] transition-colors">
                                {row.map((cell, j) => (
                                  <td key={j} className={`p-6 ${j === 0 ? 'text-white font-medium' : 'text-[#8E9299]'}`}>
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {activeTab === 'swot' && result.swot && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <SWOTCard title="Strengths" items={result.swot.strengths} color="text-green-400" bgColor="bg-green-400/5" />
                      <SWOTCard title="Weaknesses" items={result.swot.weaknesses} color="text-yellow-400" bgColor="bg-yellow-400/5" />
                      <SWOTCard title="Opportunities" items={result.swot.opportunities} color="text-blue-400" bgColor="bg-blue-400/5" />
                      <SWOTCard title="Threats" items={result.swot.threats} color="text-red-400" bgColor="bg-red-400/5" />
                    </div>
                  )}
                </motion.div>

                {/* Follow-up Section */}
                <div className="bg-[#151619] border border-[#ffffff10] rounded-2xl p-4 flex gap-4 items-center focus-within:border-[#FF4E00]/50 transition-colors">
                  <input 
                    type="text"
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isAnalyzing && followUp.trim() && analyzeDecision(undefined, followUp)}
                    placeholder="Ask a follow-up to refine this decision..."
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2 placeholder-[#4A4D54]"
                  />
                  <button
                    onClick={() => analyzeDecision(undefined, followUp)}
                    disabled={isAnalyzing || !followUp.trim()}
                    className="p-2 hover:bg-white/5 rounded-lg text-[#FF4E00] disabled:opacity-30 disabled:text-[#4A4D54] transition-all"
                  >
                    {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  </button>
                </div>
                  </>
                )}

                {/* Reset Button */}
                <div className="flex justify-center pb-20">
                  <button 
                    onClick={() => {
                      setResult(null);
                      setDecision('');
                      setUserAnswers({});
                      setThread([]);
                      setFollowUp('');
                    }}
                    className="flex items-center gap-2 text-[#8E9299] hover:text-white transition-colors py-4 px-8 border border-[#ffffff10] rounded-2xl bg-[#ffffff05]"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Start New Analysis</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// --- Sub-components ---

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`
        flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
        ${active ? 'bg-white text-black shadow-lg scale-100' : 'text-[#8E9299] hover:text-white hover:bg-white/5'}
      `}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ProsConsSection({ title, items, type }: { title: string, items: string[], type: 'pro' | 'con' }) {
  return (
    <div className="bg-[#151619] border border-[#ffffff10] rounded-2xl p-8 h-full">
      <div className="flex items-center gap-3 mb-6">
        <div className={`p-2 rounded-lg ${type === 'pro' ? 'bg-green-400/10' : 'bg-red-400/10'}`}>
          {type === 'pro' ? <Plus className="w-4 h-4 text-green-400" /> : <Minus className="w-4 h-4 text-red-400" />}
        </div>
        <h4 className="text-xs font-mono uppercase tracking-widest text-[#8E9299]">{title}</h4>
      </div>
      <ul className="space-y-4">
        {items.map((item, i) => (
          <motion.li 
            key={i} 
            initial={{ opacity: 0, x: type === 'pro' ? -10 : 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="flex gap-3 text-[#A1A1A1] leading-relaxed"
          >
            <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${type === 'pro' ? 'bg-green-400/50' : 'bg-red-400/50'}`} />
            {item}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function SWOTCard({ title, items, color, bgColor }: { title: string, items: string[], color: string, bgColor: string }) {
  return (
    <div className={`bg-[#151619] border border-[#ffffff10] rounded-2xl p-8 ${bgColor}`}>
      <h4 className={`text-xs font-mono uppercase tracking-widest mb-6 ${color}`}>{title}</h4>
      <ul className="space-y-4">
        {items.map((item, i) => (
          <motion.li 
            key={i} 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.05 }}
            className="flex gap-3 text-[#A1A1A1] leading-relaxed"
          >
            <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-white/20`} />
            {item}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
