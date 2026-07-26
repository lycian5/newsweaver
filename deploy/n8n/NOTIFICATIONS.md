# Collection Notifications

Agent Reach sends a Slack message only after the collector has finished saving, clustering, scoring, and counting ready briefs.

In `/opt/n8n/.env`, set:

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
AGENT_REACH_NOTIFY_SLACK=true
```

The message reports the trigger type, processed keywords, unique materials, updated clusters, ready briefs, extracted facts, and source failures. It links to the research brief dashboard.

If the webhook is missing, collection continues normally and the runner logs that notification delivery was skipped. Set `AGENT_REACH_NOTIFY_SLACK=false` to disable messages deliberately. Dry runs never send notifications.
