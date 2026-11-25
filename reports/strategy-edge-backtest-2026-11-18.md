# Relatorio historico do Edge Gate

- Gerado em: 2026-11-18
- Ativo informado: EURUSD; o CSV nao identifica o instrumento
- Timeframe operacional: M1, expiracao de 60 segundos (Blitz)
- Historico analisado: `candles_historico_M1_backup.csv`, 9.991 candles fechados, de 2026-11-02 10:52 UTC a 2026-11-11 09:23 UTC
- O `candles_historico.csv` original foi preservado nesse backup antes de ser substituido pelo novo export M5 em 2026-11-18.
- Sessoes observadas: 9
- Configuracao: payout 85%, breakeven 54,05%, margem 3 p.p., sessao 07:00-16:00 UTC, offset 0, empate com stake devolvida, lookback de 8 sessoes
- Gate: minimo de 300 resultados resolvidos por bucket; limite inferior Wilson de 95% acima de 57,05% e EV binario positivo
- Variantes avaliadas: 4 horizontes (M1, M3, M5 e M15); M1 e o unico horizonte operacional deste relatorio
- Modo: shadow; nenhuma ordem foi enviada

## Resultados agregados

| Expiracao | Setups sombra | Resolvidos | W/L/D | Acerto | Wilson 95% inferior | EV por stake | Sinais walk-forward aprovados |
|---|---:|---:|---:|---:|---:|---:|---:|
| M1 / 60s | 775 | 754 | 358/396/21 | 47,48% | 43,94% | -11,832% | 0 |
| M3 / 180s | 774 | 766 | 391/375/8 | 51,04% | 47,51% | -5,510% | 0 |
| M5 / 300s | 773 | 765 | 384/381/8 | 50,20% | 46,66% | -7,063% | 0 |
| M15 / 900s | 770 | 766 | 387/379/4 | 50,52% | 46,99% | -6,500% | 0 |

O breakeven e calculado como `1 / (1 + payout)`. Para a expiracao M1, o acerto agregado fica abaixo do breakeven e seu limite inferior tambem fica abaixo do minimo de 57,05% exigido pelo gate.

## Buckets de M1

Estatisticas abaixo sao agregadas retrospectivamente sobre todos os resultados sombra; nao representam apenas observacoes disponiveis em cada ponto do walk-forward. `n` conta setups; `resolvidos` exclui empates para a avaliacao Wilson. O EV inclui empate como EV zero.

| Bucket | n | Resolvidos | W/L/D | Acerto | Wilson 95% inferior | EV/stake | Gate |
|---|---:|---:|---:|---:|---:|---:|---|
| vwap-trend \| trend_up \| morning | 136 | 132 | 67/65/4 | 50,76% | 42,33% | -5,919% | Amostra insuficiente |
| vwap-trend \| trend_down \| morning | 120 | 115 | 53/62/5 | 46,09% | 37,25% | -14,125% | Amostra insuficiente |
| closing-momentum \| range \| power | 104 | 102 | 43/59/2 | 42,16% | 33,03% | -21,587% | Amostra insuficiente |
| vwap-trend \| trend_down \| power | 87 | 85 | 43/42/2 | 50,59% | 40,17% | -6,264% | Amostra insuficiente |
| vwap-trend \| range \| morning | 66 | 65 | 38/27/1 | 58,46% | 46,34% | 8,030% | Amostra insuficiente |
| closing-momentum \| compression \| power | 56 | 54 | 23/31/2 | 42,59% | 30,33% | -20,446% | Amostra insuficiente |
| closing-momentum \| trend_down \| power | 49 | 47 | 23/24/2 | 48,94% | 35,28% | -9,082% | Amostra insuficiente |
| vwap-trend \| compression \| morning | 30 | 30 | 13/17/0 | 43,33% | 27,38% | -19,833% | Amostra insuficiente |
| closing-momentum \| compression \| close | 24 | 24 | 12/12/0 | 50,00% | 31,43% | -7,500% | Amostra insuficiente |
| vwap-trend \| range \| power | 23 | 23 | 8/15/0 | 34,78% | 18,81% | -35,652% | Amostra insuficiente |
| closing-momentum \| trend_up \| power | 23 | 22 | 9/13/1 | 40,91% | 23,26% | -23,261% | Amostra insuficiente |
| vwap-trend \| compression \| power | 17 | 17 | 8/9/0 | 47,06% | 26,16% | -12,941% | Amostra insuficiente |
| closing-momentum \| expansion \| power | 9 | 8 | 5/3/1 | 62,50% | 30,57% | 13,889% | Amostra insuficiente |
| vwap-trend \| expansion \| power | 7 | 7 | 2/5/0 | 28,57% | 8,22% | -47,143% | Amostra insuficiente |
| vwap-trend \| expansion \| morning | 7 | 6 | 3/3/1 | 50,00% | 18,76% | -6,429% | Amostra insuficiente |
| vwap-trend \| trend_up \| power | 6 | 6 | 1/5/0 | 16,67% | 3,01% | -69,167% | Amostra insuficiente |
| closing-momentum \| range \| close | 4 | 4 | 2/2/0 | 50,00% | 15,00% | -7,500% | Amostra insuficiente |
| closing-momentum \| trend_down \| close | 3 | 3 | 1/2/0 | 33,33% | 6,15% | -38,333% | Amostra insuficiente |
| vwap-reversion \| range \| midday | 2 | 2 | 2/0/0 | 100,00% | 34,24% | 85,000% | Amostra insuficiente |
| vwap-reversion \| expansion \| midday | 1 | 1 | 1/0/0 | 100,00% | 20,65% | 85,000% | Amostra insuficiente |
| liquidity-sweep \| range \| midday | 1 | 1 | 1/0/0 | 100,00% | 20,65% | 85,000% | Amostra insuficiente |

Nenhum bucket alcanca os 300 resultados resolvidos. O maior tem 132. Assim, os tres casos isolados com EV positivo nao sao elegiveis e nenhum bucket passou o walk-forward.

## Metricas R: interpretacao limitada

O simulador de expiracao fixa nao tem stop ou alvo executado. Para nao confundir payoff binario com R, `rMultiple` foi ajustado para ser apenas o movimento direcional do preco dividido pelo risco estimado do setup. Essas metricas sao diagnosticas e **nao** medem o retorno de uma operacao de expiracao:

| Expiracao | Expectativa R diagnostica | Profit factor diagnostico | Drawdown diagnostico |
|---|---:|---:|---:|
| M1 | 0,0013R | 1,010 | 12,963R |
| M3 | -0,0029R | 0,988 | 34,441R |
| M5 | -0,0140R | 0,955 | 55,946R |
| M15 | -0,0350R | 0,930 | 162,997R |

Para a aposta binaria com payout informado de 85%, o payoff contratual e +0,85 stake por vitoria e -1 stake por derrota (0,85:1); a metrica operacional reportada e EV por stake.

## Custos, robustez e decisao

- Custo real por operacao: desconhecido. O valor zero usado pelo script e somente um placeholder, nao uma estimativa.
- Cenarios com custo 1x e 2x: nao calculados; o EV acima nao deve ser interpretado como liquido de custos.
- Bootstrap em blocos por dia, CPCV, Deflated Sharpe Ratio e paper trading de 30 dias: nao executados.
- O historico nao inclui o identificador do instrumento, preco de execucao, payout observado por ordem nem custos; EURUSD e apenas o rotulo fornecido para esta analise.
- Decisao: **nenhum bucket e elegivel para uso live**. Mantenha o motor novo em shadow e o caminho de execucao bloqueado ate coletar uma amostra maior, calibrar custos e concluir a validacao pendente.

