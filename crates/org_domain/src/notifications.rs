use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{agenda::AgendaItem, habit::Habit};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationRequest {
    pub title: String,
    pub body: String,
    pub scheduled_for: DateTime<Utc>,
}

/// Platform-specific notification adapters will implement this trait.
pub trait NotificationSink: Send + Sync {
    fn schedule(&self, notification: NotificationRequest);
    fn clear_for_habit(&self, habit: &Habit);
    fn clear_for_agenda_item(&self, item: &AgendaItem);
}
