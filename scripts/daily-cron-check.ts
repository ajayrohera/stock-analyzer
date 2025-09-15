// scripts/daily-cron-check.ts
import fs from 'fs/promises';
import path from 'path';

const CRON_LOG_FILE = path.join(process.cwd(), 'cron-log.json');

async function dailyCronCheck() {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  try {
    const data = await fs.readFile(CRON_LOG_FILE, 'utf-8');
    const logs = JSON.parse(data);
    
    // Check yesterday's execution
    const yesterdayLogs = logs.filter((log: any) => 
      log.timestamp.includes(yesterday)
    );
    
    if (yesterdayLogs.length === 0) {
      console.log(`❌ CRON ALERT: No execution found for ${yesterday}`);
      // Here you could add email/slack notification
    } else {
      const successful = yesterdayLogs.filter((log: any) => log.success);
      console.log(`✅ Yesterday (${yesterday}): ${successful.length}/${yesterdayLogs.length} successful`);
    }
    
  } catch (error) {
    console.log('❌ Error checking cron logs');
  }
}

dailyCronCheck();