"use client";

import LogRocket from "logrocket";
import setupLogRocketReact from "logrocket-react";

import packageJson from "@/package.json";

const logRocketAppId = "bespoke/scheduler";
const webPackageVersion = packageJson.version;
const logRocketRelease = `web@${webPackageVersion}`;

let logRocketWasStarted = false;
let identifiedUserId: string | null = null;

type LogRocketUserIdentity = {
  userId: string;
};

type SchedulePeriodCreatedEvent = {
  schedulePeriodId: string;
  scheduleName: string;
};

type SchedulePeriodRenamedEvent = {
  schedulePeriodId: string;
  scheduleName: string;
};

type SchedulePeriodDeletedEvent = {
  schedulePeriodId: string;
};

type SchedulePeriodClonedEvent = {
  sourceSchedulePeriodId: string;
  clonedSchedulePeriodId: string;
};

type ScheduleDraftSavedEvent = {
  schedulePeriodId: string;
  scheduleVersionId: string;
  assignmentCount: number;
};

type ScheduleGeneratedEvent = {
  schedulePeriodId: string;
  scheduleVersionId: string;
  assignmentCount: number;
  solveDurationMs: number;
};

type SchedulePublishedEvent = {
  schedulePeriodId: string;
  scheduleVersionId: string;
};

type ScheduleWorkflowException = {
  workflowName: string;
  error: unknown;
};

export function startLogRocket() {
  if (logRocketWasStarted) {
    return;
  }

  LogRocket.init(logRocketAppId, {
    release: logRocketRelease,
  });

  setupLogRocketReact();
  logRocketWasStarted = true;
}

export function identifyLogRocketUser(identity: LogRocketUserIdentity) {
  startLogRocket();

  if (identifiedUserId === identity.userId) {
    return;
  }

  LogRocket.identify(identity.userId);
  identifiedUserId = identity.userId;
}

export function trackSchedulePeriodCreated(event: SchedulePeriodCreatedEvent) {
  startLogRocket();

  const eventProperties = {
    schedulePeriodId: event.schedulePeriodId,
    scheduleName: event.scheduleName,
  };

  LogRocket.track("SchedulePeriodCreated", eventProperties);
}

export function trackSchedulePeriodRenamed(event: SchedulePeriodRenamedEvent) {
  startLogRocket();

  const eventProperties = {
    schedulePeriodId: event.schedulePeriodId,
    scheduleName: event.scheduleName,
  };

  LogRocket.track("SchedulePeriodRenamed", eventProperties);
}

export function trackSchedulePeriodDeleted(event: SchedulePeriodDeletedEvent) {
  startLogRocket();

  const eventProperties = {
    schedulePeriodId: event.schedulePeriodId,
  };

  LogRocket.track("SchedulePeriodDeleted", eventProperties);
}

export function trackSchedulePeriodCloned(event: SchedulePeriodClonedEvent) {
  startLogRocket();

  const eventProperties = {
    sourceSchedulePeriodId: event.sourceSchedulePeriodId,
    clonedSchedulePeriodId: event.clonedSchedulePeriodId,
  };

  LogRocket.track("SchedulePeriodCloned", eventProperties);
}

export function trackScheduleDraftSaved(event: ScheduleDraftSavedEvent) {
  startLogRocket();

  const eventProperties = {
    schedulePeriodId: event.schedulePeriodId,
    scheduleVersionId: event.scheduleVersionId,
    assignmentCount: event.assignmentCount,
  };

  LogRocket.track("ScheduleDraftSaved", eventProperties);
}

export function trackScheduleGenerated(event: ScheduleGeneratedEvent) {
  startLogRocket();

  const eventProperties = {
    schedulePeriodId: event.schedulePeriodId,
    scheduleVersionId: event.scheduleVersionId,
    assignmentCount: event.assignmentCount,
    solveDurationMs: event.solveDurationMs,
  };

  LogRocket.track("ScheduleGenerated", eventProperties);
}

export function trackSchedulePublished(event: SchedulePublishedEvent) {
  startLogRocket();

  const eventProperties = {
    schedulePeriodId: event.schedulePeriodId,
    scheduleVersionId: event.scheduleVersionId,
  };

  LogRocket.track("SchedulePublished", eventProperties);
}

export function captureScheduleWorkflowException(event: ScheduleWorkflowException) {
  startLogRocket();

  const tags = {
    workflow: event.workflowName,
  };

  if (event.error instanceof Error) {
    LogRocket.captureException(event.error, {
      tags,
    });
    return;
  }

  const extra = {
    errorType: typeof event.error,
  };

  LogRocket.captureMessage("Schedule workflow failed with a non-Error value.", {
    tags,
    extra,
  });
}
