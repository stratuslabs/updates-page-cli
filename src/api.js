const { requireConfig } = require('./config');

class ApiClient {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  static fromConfig() {
    const config = requireConfig();
    return new ApiClient(config.apiKey, config.baseUrl);
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        if (isJson) {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.errors || errorMessage;
        }
        throw new Error(errorMessage);
      }

      return isJson ? await response.json() : await response.text();
    } catch (error) {
      if (error.cause && error.cause.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to ${this.baseUrl}. Is the server running?`);
      }
      throw error;
    }
  }

  // Announcements
  async listAnnouncements(status = null) {
    let endpoint = '/api/v1/announcements';
    if (status) {
      endpoint += `?status=${status}`;
    }
    return this.request(endpoint);
  }

  async getAnnouncement(id) {
    return this.request(`/api/v1/announcements/${id}`);
  }

  async createAnnouncement(data, publish = false) {
    const announcement = await this.request('/api/v1/announcements', {
      method: 'POST',
      body: JSON.stringify({ announcement: data }),
    });

    if (publish && announcement.id) {
      return this.publishAnnouncement(announcement.id);
    }

    return announcement;
  }

  async publishAnnouncement(id) {
    return this.request(`/api/v1/announcements/${id}/publish`, {
      method: 'POST',
    });
  }

  // Categories
  async listCategories() {
    return this.request('/api/v1/categories');
  }
}

module.exports = ApiClient;
