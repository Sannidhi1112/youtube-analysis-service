const request = require('supertest');
const app = require('./server');

describe('YouTube Analysis Service', () => {
  let server;

  beforeAll((done) => {
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  describe('GET /', () => {
    it('should return the main page', async () => {
      const response = await request(app).get('/');
      expect(response.status).toBe(200);
      expect(response.text).toContain('YouTube Analysis Service');
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('POST /analyze', () => {
    it('should reject invalid YouTube URLs', async () => {
      const response = await request(app)
        .post('/analyze')
        .send({ youtube_url: 'https://example.com' });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject missing YouTube URL', async () => {
      const response = await request(app)
        .post('/analyze')
        .send({});
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'YouTube URL is required');
    });

    it('should accept valid YouTube URLs', async () => {
      const response = await request(app)
        .post('/analyze')
        .send({ youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
      
      // Note: This test may fail without proper API keys
      // In a real environment, you'd mock the external services
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('job_id');
      expect(response.body).toHaveProperty('status', 'processing');
    });
  });

  describe('GET /result/:id', () => {
    it('should return 404 for non-existent job', async () => {
      const response = await request(app).get('/result/non-existent-id');
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Result not found');
    });
  });

  describe('GET /status/:id', () => {
    it('should return processing status for non-existent job', async () => {
      const response = await request(app).get('/status/non-existent-id');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'processing');
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to /analyze endpoint', async () => {
      // This test would need to be adjusted based on your rate limit settings
      const promises = [];
      for (let i = 0; i < 12; i++) {
        promises.push(
          request(app)
            .post('/analyze')
            .send({ youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
        );
      }

      const responses = await Promise.all(promises);
      const tooManyRequests = responses.filter(r => r.status === 429);
      expect(tooManyRequests.length).toBeGreaterThan(0);
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await request(app).get('/unknown-endpoint');
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Endpoint not found');
    });
  });
});

// Integration tests for utility functions
describe('Utility Functions', () => {
  const { validateYouTubeUrl } = require('./server');

  describe('validateYouTubeUrl', () => {
    const validUrls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    ];

    const invalidUrls = [
      'https://example.com',
      'https://vimeo.com/123456',
      'not-a-url',
      'https://youtube.com',
      'https://www.youtube.com/user/test'
    ];

    validUrls.forEach(url => {
      it(`should validate ${url}`, () => {
        expect(validateYouTubeUrl(url)).toBe(true);
      });
    });

    invalidUrls.forEach(url => {
      it(`should reject ${url}`, () => {
        expect(validateYouTubeUrl(url)).toBe(false);
      });
    });
  });
});

// Mock tests for external services (when API keys are not available)
describe('External Service Mocks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle transcription service errors gracefully', async () => {
    // Mock axios to simulate API failure
    const axios = require('axios');
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('API Error'));

    // Test error handling
    const { transcribeAudio } = require('./server');
    await expect(transcribeAudio('/fake/path')).rejects.toThrow();
  });

  it('should handle AI detection service errors gracefully', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('API Error'));

    const { detectAI } = require('./server');
    const result = await detectAI('test text');
    
    expect(result).toHaveProperty('ai_probability', 0);
    expect(result).toHaveProperty('classification', 'error');
    expect(result).toHaveProperty('error');
  });
});