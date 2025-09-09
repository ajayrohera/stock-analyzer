// This is the correct code for your next.config.ts file

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // This part is to fix the 'ws' library issue during Vercel deployment
    if (!isServer) {
      config.resolve.alias.ws = false;
    }
    config.externals.push('bufferutil', 'utf-8-validate');
    return config;
  },
};

export default nextConfig;