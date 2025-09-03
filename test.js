const axios = require('axios');

async function testGemini() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY);
  console.log('API Key Length:', process.env.GEMINI_API_KEY.length);
  console.log('API Key Trimmed:', process.env.GEMINI_API_KEY.trim());

  const prompt = `
    You are a game question generator. Return ONLY a valid JSON object with two fields: "question" and "specialQuestion". The "question" must be positive and aspirational, phrased as "Who is most likely to..." (e.g., "Who is most likely to win a Nobel Prize?"). The "specialQuestion" must be humorous or quirky, phrased as "Who is most likely to..." (e.g., "Who is most likely to forget their own name?"). Do NOT include any text, markdown, backticks, code blocks (e.g., \`\`\`json or \`\`\`), comments, explanations, or conversational responses like "I'm not sure" or "Could you explain". If you cannot generate the requested output, return an empty JSON object {}.
    Example: {"question": "Who is most likely to become a famous scientist?", "specialQuestion": "Who is most likely to trip over their own feet?"}
  `;

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 500, temperature: 0.7, topP: 0.9 }
  };

  console.log('Request URL:', `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`);
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      requestBody,
      { headers: { 'Content-Type': 'application/json' } }
    );
    let responseText = response.data.candidates[0]?.content?.parts[0]?.text || '{}';
    console.log('Raw Response:', responseText);

    // Strip Markdown code blocks
    responseText = responseText.replace(/```json\n|```\n/g, '').trim();
    console.log('Cleaned Response:', responseText);

    try {
      const parsed = JSON.parse(responseText);
      if (!parsed.question || !parsed.specialQuestion) {
        throw new Error('Missing required fields in JSON');
      }
      if (!parsed.question.startsWith('Who is most likely to') || !parsed.specialQuestion.startsWith('Who is most likely to')) {
        throw new Error('Questions do not follow required "Who is most likely to..." format');
      }
      console.log('Parsed JSON:', parsed);
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
    }
  } catch (error) {
    console.error('API Error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
  }
}

testGemini().catch(console.error);