
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { fileBase64, mimeType, language, quizType, difficulty, count } = req.body || {};

  if (!fileBase64 || !mimeType) {
    res.status(400).json({ error: "File is required" });
    return;
  }

  const languageLabels = { auto: null, hindi: "Hindi (Devanagari script)", english: "English", hinglish: "Hinglish (Roman script, natural Hindi-English mix)" };
  const quizTypeInstructions = {
    mcq: 'Every question must be type "mcq" with exactly 4 balanced options and one correctIndex (0-3).',
    truefalse: 'Every question must be type "truefalse" with exactly 2 options meaning True and False (translated into the target language, e.g. "सत्य"/"असत्य" for Hindi) and correctIndex (0 or 1).',
    fill: 'Every question must be type "fill" — a sentence with a blank (use ______ for the blank). Provide "acceptableAnswers": an array of 2-4 acceptable correct answer variants (different spellings/phrasings) instead of options/correctIndex.',
    oneword: 'Every question must be type "oneword" — a short direct question expecting a one or two word answer. Provide "acceptableAnswers": an array of 2-4 acceptable correct answer variants instead of options/correctIndex.',
    mixed: 'Vary question types across mcq, truefalse, fill, and oneword — use a good mix. For mcq/truefalse include "options" (array) and "correctIndex". For fill/oneword include "acceptableAnswers" (array) instead.',
  };
  const difficultyLabels = {
    easy: "Easy — basic recall and direct facts from the material.",
    medium: "Medium — requires understanding and connecting 2 ideas from the material.",
    hard: "Hard — requires deeper analysis, application, or comparing multiple concepts from the material.",
    competitive: "Competitive exam level — tricky, precise, similar to real competitive/board exam questions, testing nuanced understanding.",
  };

  const numQuestions = parseInt(count, 10) || 10;
  const isAutoLanguage = !language || language === "auto";
  const langLabel = isAutoLanguage ? null : (languageLabels[language] || "Hindi (Devanagari script)");
  const languageInstruction = isAutoLanguage
    ? "Detect the primary language and script used in the uploaded document (e.g. Hindi/Devanagari, English, Marathi, etc). Write ALL questions, options, topic tags, and explanations in that SAME language and script as the source document. If the document mixes languages, use whichever language dominates the content."
    : `Write all questions, options, topic tags, and explanations in ${langLabel}, regardless of the uploaded document's own language.`;
  const qTypeInstruction = quizTypeInstructions[quizType] || quizTypeInstructions.mcq;
  const diffLabel = difficultyLabels[difficulty] || difficultyLabels.medium;

  const prompt = `You are an expert exam-question setter for Indian students (school boards and competitive exams). You have been given a document (image or PDF of study notes / textbook pages / scanned material).

YOUR PROCESS (do this internally before answering):
1. Carefully read and understand ALL content in the uploaded material (perform OCR mentally if it's a scanned image).
2. Identify the key concepts, important facts, and any repeated or emphasized ideas.
3. Understand the structure/hierarchy of topics covered.
4. Only then, write exam-quality questions.

STRICT RULES:
- Base every question ONLY on information actually present in the uploaded material. Never invent facts, numbers, or details not present in the document.
- If the material is too short or unclear to generate the requested number of quality questions, generate as many high-quality questions as the content genuinely supports (do not pad with filler or repeat questions).
- No duplicate or near-duplicate questions.
- LANGUAGE: ${languageInstruction} Keep the language natural and grammatically correct.
- ${qTypeInstruction}
- Difficulty level: ${diffLabel} Gradually increase difficulty across the question set.
- Each question must include a short "topic" tag (2-4 words, matching the same language as your answers) representing which concept/sub-topic it tests — this is used to build a performance report, so keep topic tags consistent when multiple questions share a topic.
- Each question must include a short "explanation" (1-2 sentences, matching the same language as your answers) explaining why the correct answer is right.
- Avoid options that are obviously wrong or absurd for mcq/truefalse — all 4 options should be plausible.

Generate exactly ${numQuestions} questions (or fewer only if the material genuinely does not support that many).

Return ONLY raw JSON, no markdown code fences, no commentary, matching exactly this shape:
{
  "quizTitle": "short descriptive title based on the material, in the same language as the questions",
  "questions": [
    {
      "type": "mcq" | "truefalse" | "fill" | "oneword",
      "topic": "short topic tag",
      "question": "question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correctIndex": 0,
      "acceptableAnswers": ["answer variant 1", "answer variant 2"],
      "explanation": "short explanation"
    }
  ]
}

Note: only include "options" and "correctIndex" for mcq/truefalse types. Only include "acceptableAnswers" for fill/oneword types.`;

  try {
    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const maxOutputTokens = Math.min(8192, numQuestions * 300 + 2000);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: fileBase64 } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens,
          temperature: 0.6,
          response_mime_type: "application/json",
          thinking_config: { thinking_budget: 0 },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      res.status(502).json({ error: "Upstream API error" });
      return;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      res.status(502).json({ error: "No questions generated" });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error("Generate quiz function error:", err);
    res.status(500).json({ error: "Quiz generation failed" });
  }
    }
