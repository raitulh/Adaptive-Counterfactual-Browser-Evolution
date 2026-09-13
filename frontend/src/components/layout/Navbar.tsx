"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Play, Terminal, ArrowRight, Github } from "lucide-react";
import { RunTaskModal } from "@/components/modals/RunTaskModal";

export const Navbar: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-white/[0.08] bg-[#07080a]/80 backdrop-blur-xl transition-all">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="font-mono font-black text-xl tracking-tight text-white group-hover:text-amber-400 transition-colors">
                <span className="text-amber-400">AC</span>BE
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm text-gray-400">
              <a href="#how-to-use" className="hover:text-white transition-colors">How to Use</a>
              <a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a>
              <a href="#comparison" className="hover:text-white transition-colors">Before vs After</a>
              <a href="#code" className="hover:text-white transition-colors">Developers</a>
              <Link href="/console" className="text-amber-400/90 hover:text-amber-300 font-medium transition-colors flex items-center gap-1">
                <Terminal className="w-3.5 h-3.5" /> Console
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setModalOpen(true)}
              className="hidden sm:inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-surface-subtle hover:bg-surface-border text-gray-200 border border-surface-border transition-all"
            >
              <Play className="w-3 h-3 text-amber-400 fill-current" /> Quick Run
            </button>

            <Link
              href="/console"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/10 hover:shadow-amber-500/25"
            >
              Launch Console <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <RunTaskModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};
