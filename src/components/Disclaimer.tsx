import { ShieldAlert } from 'lucide-react'

export function Disclaimer() {
  return (
    <section
      aria-labelledby="disclaimer-heading"
      className="rounded-[20px] border border-warn/15 bg-warn/[0.025] p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-warn/20 bg-warn/[0.06] text-warn">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="disclaimer-heading" className="font-display text-[13px] font-semibold text-content">
            Aviso legal
          </h2>
          <p className="mt-1.5 max-w-4xl text-[10.5px] leading-relaxed text-muted">
            Conteúdo exclusivamente educacional. Opções binárias são produtos de alto risco e podem
            resultar na perda total do capital. Resultados passados não se repetem necessariamente.
            Esta interface gerencia ordens para a corretora por meio do bot externo em Python; o
            bot consulta ativos e payouts na IQ Option e só envia operações após a ativação
            explícita do Auto-Trade. Este conteúdo não constitui recomendação de investimento.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {[
              'Bot externo IQ Option',
              'Sem martingale',
              'Auto-Trade explícito',
            ].map((label) => (
              <span
                key={label}
                className="rounded-full border border-line bg-white/[0.02] px-2 py-0.5 text-[8.5px] uppercase tracking-[0.08em] text-muted"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
