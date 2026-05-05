/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/overpass',
        destination: 'https://overpass-api.de/api/interpreter',
      },
    ];
  },
};

module.exports = nextConfig;
