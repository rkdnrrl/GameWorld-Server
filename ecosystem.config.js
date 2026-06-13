// pm2 cluster 설정 — 2 vCPU 를 다 쓰고 워커 1개가 죽어도 생존.
// 최초 전환(1회): pm2 delete platform && pm2 start ecosystem.config.js && pm2 save
// 이후 배포(deploy-backend.sh)의 `pm2 reload platform --update-env` 가 무중단 롤링 리로드.
module.exports = {
  apps: [
    {
      name: 'platform',
      script: 'src/server.js',
      exec_mode: 'cluster',
      instances: 2, // = vCPU 수. 인스턴스 업그레이드로 코어가 늘면 이 값도 올릴 것(워커>코어는 역효과).
      // 워커가 메모리 누수로 커지면 자동 재시작 → 2GB 인스턴스 OOM 방지(워커 2개 × 750M 여유).
      max_memory_restart: '750M',
      env: { NODE_ENV: 'production' },
      // 비정상 종료 시 빠른 재시작 루프 방지(uncaughtException → exit 시 backoff).
      exp_backoff_restart_delay: 200,
    },
  ],
};
