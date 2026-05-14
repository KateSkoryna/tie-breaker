# Tiebreaker AI - Ultimate Decision Helper

An AI-powered decision-making tool built with React and Gemini 2.0 Flash.

## 🚀 How to Run Locally

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd <repo-folder>
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up your API Key:**
   Create a `.env` file in the root directory:
   ```env
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   ```
   *Get your key at [Google AI Studio](https://aistudio.google.com/app/apikey).*

4. **Start the development server:**
   ```bash
   npm run dev
   ```

## 🛠 Model Information

This app uses **Gemini 2.0 Flash**.
- **Model Name:** `gemini-2.0-flash`
- **Benefits:** High speed, ultra-low cost, and a 1 million token context window.

## 🤖 GitHub Actions CI/CD

The project includes a `.github/workflows/deploy.yml` file. This workflow:
- Automatically builds the app on every push to `main`.
- Validates that your code is functional.

### Setting up Secrets
To make the build work on GitHub, go to **Settings > Secrets and variables > Actions** in your GitHub repo and add:
- `GEMINI_API_KEY`: Your Google AI Studio API key.

## 📦 Features
- **Smart Decision Threads:** Refine decisions with follow-up questions without restarting.
- **Deep Analysis:** Pros/Cons, Comparison Tables, and SWOT analysis.
- **History:** Local history with relative time markers.
- **Context Profile:** Save your personal constraints (budget, location, goals) for better advice.
