"use client";

import { cn } from "@/lib/utils";

type MedalType = "bronze" | "silver" | "gold" | "platinum" | "diamond";
type MedalRank = 0 | 1 | 2; // 0: dull, 1: normal, 2: shiny

interface MedalProps {
  type: MedalType;
  rank: MedalRank;
  label?: string | number;
}

export function Medal({ type, rank, label }: MedalProps) {
  const isDiamond = type === "diamond";

  return (
    <div
      className={cn(
        "flex items-center justify-center font-black text-[8px] leading-none shrink-0",
        isDiamond ? "w-3 h-3 rounded-[1px] rotate-45 scale-90" : "w-3 h-3 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.3)]",
        // Bronze
        type === "bronze" && rank === 0 && "bg-[radial-gradient(circle_at_40%_35%,#B9906E,#8C5E3A_60%,#664127)] text-white",
        type === "bronze" && rank === 1 && "bg-[radial-gradient(circle_at_34%_30%,#EBC39C,#C27A3E_55%,#7E4A1E)] text-black",
        type === "bronze" && rank === 2 && "bg-[radial-gradient(circle_at_30%_26%,#FFE3C4_0%,#E3903F_38%,#9A5520_100%)] shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_4px_rgba(227,144,63,0.85)] text-black",
        // Silver
        type === "silver" && rank === 0 && "bg-[radial-gradient(circle_at_40%_35%,#C4C4C4,#979797_60%,#6E6E6E)] text-black",
        type === "silver" && rank === 1 && "bg-[radial-gradient(circle_at_34%_30%,#F2F2F2,#B8B8B8_55%,#7A7A7A)] text-black",
        type === "silver" && rank === 2 && "bg-[radial-gradient(circle_at_30%_26%,#FFFFFF_0%,#E4E4E4_35%,#9A9A9A_100%)] shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_4px_rgba(255,255,255,0.95)] text-black",
        // Gold
        type === "gold" && rank === 0 && "bg-[radial-gradient(circle_at_40%_35%,#D6C07E,#B39433_60%,#86690F)] text-black",
        type === "gold" && rank === 1 && "bg-[radial-gradient(circle_at_34%_30%,#FFF0A8,#E8BE1E_55%,#9C7400)] text-black",
        type === "gold" && rank === 2 && "bg-[radial-gradient(circle_at_30%_26%,#FFFBE0_0%,#FFD700_38%,#C08A00_100%)] shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_0_5px_rgba(255,215,0,0.95)] text-black",
        // Platinum
        type === "platinum" && rank === 0 && "bg-[radial-gradient(circle_at_40%_35%,#E3EAEE,#AEBFCA_60%,#7D93A2)] shadow-[0_0_0_1px_#5A7282] text-black",
        type === "platinum" && rank === 1 && "bg-[radial-gradient(circle_at_34%_30%,#FAFDFF,#C9D9E3_50%,#7F9AAC)] shadow-[0_0_0_1px_#57758A] text-black",
        type === "platinum" && rank === 2 && "bg-[radial-gradient(circle_at_30%_26%,#FFFFFF_0%,#E4F4FC_40%,#8FB9CF_100%)] shadow-[0_0_0_1px_#4E7A92,0_0_5px_rgba(200,235,250,0.95)] text-black",
        // Diamond
        type === "diamond" && rank === 0 && "bg-[linear-gradient(135deg,#EAFBFF,#A3DDEE_60%,#70B9CF)] shadow-[0_0_0_1px_#3F8FA8] text-black",
        type === "diamond" && rank === 1 && "bg-[linear-gradient(135deg,#F7FEFF,#B4ECF8_50%,#6CC6DE)] shadow-[0_0_0_1px_#3593B0,0_0_3px_rgba(95,205,235,0.8)] text-black",
        type === "diamond" && rank === 2 && "bg-[linear-gradient(135deg,#FFFFFF,#BDF4FF_40%,#5FCDEB_70%,#FFFFFF)] shadow-[0_0_0_1px_#2B8FB0,0_0_7px_1px_rgba(95,205,235,0.95)] text-black",
      )}
    >
      <span className={isDiamond ? "-rotate-45" : ""}>{label}</span>
    </div>
  );
}
