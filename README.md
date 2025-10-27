# Trabalho — Streaming / Assinaturas (Pró-rata) 

# Desenvolvido por: @Guilherme Stein e @Samuel Wiggers

Este é um exemplo simples em JavaScript (HTML + CSS + JS) para demonstrar conceitos de programação funcional aplicados a streaming/assinaturas.

Funcionalidades:
- Entrada de eventos via formulário (subscribe, change, cancel)
- Exportação dos eventos em JSON para uso externo
- Validação pura das entradas
- Cálculo pró-rata por dias em cada plano
- Suporte a descontos promocionais por segmento e multa por cancelamento (opcional)
- Métricas simples: receita total por mês, ARPU, churn (estimado)

Como usar:
1. Abra o arquivo `index.html` em um navegador.
2. Use o formulário para adicionar eventos (usuário, tipo, plano, data, desconto ou penalidade).
3. Os eventos adicionados aparecem na lista "Eventos atuais" abaixo do formulário.
4. Use "Carregar Exemplo" para carregar dados de amostra, "Exportar JSON" para baixar os eventos atuais, e "Calcular" para gerar o relatório mensal.

Observações técnicas:
- Todas as funções de transformação e cálculo foram escritas como funções puras (sem efeitos colaterais) quando possível.
- A imutabilidade foi respeitada: objetos de entrada são copiados e não alterados.
- Foram utilizados higher-order functions como `map`, `filter` e `reduce`.
- Nota: a interface não inclui um editor JSON embutido — a exportação existe para salvar/importar eventos externamente.

Estrutura de arquivos:
- `index.html` — interface simples (formulário e resultados)
- `styles.css` — estilos mínimos
- `app.js` — lógica funcional, validação e UI
