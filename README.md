# ANTS Voice — clickable product demo

Interactive demo of the ANTS Voice console, part of the ANTS communication platform (SMS · LINE · Email · Voice).

**Live demo:** https://ai-solution-platform.github.io/voice/

- **Sample data only.** No real calls are made and nothing is charged. All names, companies, phone numbers (masked), keys and hosts (`*.example`, `example.com`) are invented.
- **Languages:** English · ไทย · 中文 — switch at the top right, or open with `?lang=th` / `?lang=zh`.
- **Prices** are planned launch prices in credits, excluding VAT, and may change before launch.
- **Audio:** test calls and recordings are read aloud by your browser's built-in speech voices; transcripts are simulated.

## Things to try
1. **Test call** — dial, hear the ringback, the message is read aloud, then find the call in **Call logs**.
2. **Connect** — copy an API sample, or follow the 5-step SIP trunk wizard.
3. **Campaigns** — create a reminder campaign: see the cost before launch, confirm, and watch live progress.
4. **Billing** — top up credits, compare pay as you go with volume plans.
5. **Demo controls** (sidebar foot / footer) — switch between a new account and a busy account, simulate an error, or reset the demo.

## Run locally
```sh
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```
No build step: plain HTML, CSS and JavaScript modules.
