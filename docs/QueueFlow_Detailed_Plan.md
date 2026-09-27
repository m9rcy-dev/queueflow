# QueueFlow — Detailed Product & Engineering Plan

## 1. Document Purpose

This document is the implementation blueprint for **QueueFlow**, a multi-tenant web-based queue and appointment management platform.

The platform allows businesses to replace physical queue numbers with digital queues:

1. Customer scans a QR code or barcode.
2. Customer selects a service or is taken directly to a service queue.
3. Customer enters minimal contact information.
4. Customer receives a digital queue ticket.
5. Customer can view live queue position and estimated wait time.
6. The business operates the queue from a staff dashboard.
7. SMS notifications inform the customer when they are approaching their turn and when they are called.
8. Businesses can also offer appointments.
9. Appointments can be checked in and converted into queue entries.
10. A public display can show the currently-served ticket and upcoming information.

The system must be designed as a **multi-tenant SaaS**, even if the initial deployment has only one business.

---

# 2. Product Vision

QueueFlow should provide a simple digital replacement for traditional queue tickets.

The primary experience should require:

- no customer account for normal walk-ins
- no mobile application installation
- QR-code scanning from a phone
- minimal data entry
- live queue updates
- optional SMS notifications

The business experience should provide:

- live queue management
- appointment scheduling
- staff management
- service management
- queue configuration
- public queue display
- analytics
- configurable notifications
- multiple locations
- role-based access

The system must remain generic enough to support:

- barber shops
- salons
- repair shops
- mechanics
- government/customer service centres
- clinics
- restaurants
- retail service desks
- workshops
- other appointment or walk-in services

The queue engine must not contain business-specific logic.

---

# 3. Product Principles

## 3.1 Customer-first

The customer should be able to join a queue in seconds.

Avoid:

- mandatory account creation
- unnecessary forms
- application installation
- unnecessary personal information

## 3.2 Business-agnostic

The platform should model:

- tenant
- location
- service
- staff
- queue
- customer
- appointment

rather than "barber", "haircut", etc.

## 3.3 API-first

All important operations should be available through application services/API endpoints rather than being tightly coupled to a particular frontend.

## 3.4 Secure by default

Tenant isolation, authorization, rate limiting, audit logging and privacy controls must be part of the initial architecture.

## 3.5 Modular monolith first

Do not start with microservices.

Use a modular Spring Boot application with clear domain boundaries.

The architecture should permit future extraction of modules into services if scale requires it.

## 3.6 Event-oriented internally

Important state transitions should generate domain/application events.

Examples:

- QueueEntryCreated
- QueueEntryCalled
- QueueEntryCancelled
- QueueEntryCompleted
- AppointmentCreated
- AppointmentCheckedIn
- NotificationRequested
- NotificationSent

Kafka should not be required for the MVP.

A transactional outbox can be introduced before Kafka if asynchronous integration becomes necessary.

---

# 4. Core Architectural Evolution — QR Context Platform

The original concept treated the QR code primarily as a way to join a queue.

The architecture should instead treat the QR code as a **physical-world entry point into a business's digital experience**.

The core abstraction is:

```text
QR / Barcode
      ↓
Context Resolver
      ↓
Physical / Business Context
      ↓
Available Capabilities
      ↓
Customer Workflow
```

This allows the same QR infrastructure to support:

- queue joining
- appointment booking
- table ordering
- menu access
- calling staff
- requesting assistance
- service check-in
- future payments
- customer forms
- loyalty
- product/service information
- future business integrations

The QR code is therefore **not a queue identifier**.

It is a **context identifier**.

## 4.1 Example contexts

A QR code can resolve to:

```text
QUEUE
TABLE
SERVICE
LOCATION
APPOINTMENT
KIOSK
COUNTER
PRODUCT
GENERAL
```

Examples:

### Barber

```text
QR
 ↓
Location: Christchurch
Context: HAIRCUT_QUEUE
 ↓
Join Queue
Book Appointment
```

### Restaurant table

```text
QR
 ↓
Location: Christchurch
Context: TABLE
Context ID: TABLE-12
 ↓
View Menu
Order Food
Call Staff
Request Bill
Pay
```

### Mechanic

```text
QR
 ↓
Location: Christchurch
Context: SERVICE
Context ID: VEHICLE-SERVICE
 ↓
Join Queue
Book Service
Check Status
```

## 4.2 Context is separate from capability

A physical context should not determine one hard-coded workflow.

For example:

```text
TABLE-12
```

can expose:

```text
VIEW_MENU
ORDER
CALL_STAFF
REQUEST_BILL
PAY
```

A queue QR can expose:

```text
JOIN_QUEUE
BOOK_APPOINTMENT
```

The business configuration determines which capabilities are enabled.

## 4.3 Architecture

```text
                         QR / BARCODE
                              │
                              ▼
                     ┌─────────────────┐
                     │ Context Resolver│
                     └────────┬────────┘
                              │
                              ▼
                       QR Context
                              │
                ┌─────────────┼─────────────┐
                │             │             │
                ▼             ▼             ▼
             QUEUE          TABLE       APPOINTMENT
                │             │             │
                ▼             ▼             ▼
             Waiting        Ordering      Booking
             Calling        Menu          Check-in
             SMS            Staff         Reminders
                            Payment
```

## 4.4 Future payment architecture

Payment should eventually use the same context model but remain a separate bounded module.

For example:

```text
Table 12
   ↓
Order
   ↓
Bill
   ↓
Payment
   ↓
Payment Provider
```

The QR code should never contain payment credentials or sensitive payment information.

Instead:

```text
QR
 ↓
Secure Context Token
 ↓
Authenticated/validated session
 ↓
Order / Bill
 ↓
Payment intent
 ↓
Payment provider
```

Payment details should be handled by a compliant payment provider rather than stored directly in QueueFlow unless there is a specific future requirement to do so.

## 4.5 Why this architecture matters

This prevents the platform from becoming:

```text
Queue app + separate restaurant app + separate booking app
```

Instead, it becomes:

```text
Business Digital Experience Platform
             │
             ├── Queue
             ├── Appointments
             ├── Ordering
             ├── Staff Requests
             ├── Payments
             └── Future Capabilities
```

The platform can therefore expand without redesigning its QR infrastructure.

# 4. Recommended Technology Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- TanStack Query
- Zod
- Playwright for end-to-end testing

## Backend

- Java
- Spring Boot
- Spring Security
- Spring Data JPA or carefully selected JDBC approach
- PostgreSQL
- Flyway or Liquibase
- Redis for caching/realtime support where useful
- Testcontainers
- JUnit
- WireMock or MockServer for external integration tests

## Realtime

Start with Server-Sent Events (SSE).

Use SSE for:

- queue position changes
- queue state changes
- currently serving ticket
- appointment/queue display updates

Use WebSockets only if a later requirement demonstrates that bidirectional realtime communication is necessary.

## Infrastructure

Development:

- Docker Compose
- PostgreSQL
- Redis
- mock SMS provider

Production:

- containerized deployment
- Kubernetes/OpenShift-compatible deployment
- managed PostgreSQL where available
- managed Redis where appropriate
- external SMS provider

Infrastructure should remain provider-neutral initially.

---

# 5. High-Level Architecture

```text
                         ┌──────────────────────┐
                         │      Next.js Web      │
                         │                      │
                         │ Customer / Staff /   │
                         │ Admin / Display      │
                         └──────────┬───────────┘
                                    │
                             HTTPS / REST / SSE
                                    │
                         ┌──────────▼───────────┐
                         │     Spring Boot      │
                         │    Modular Monolith   │
                         │                       │
                         │ Tenant                │
                         │ Location              │
                         │ Service               │
                         │ Queue                 │
                         │ Customer              │
                         │ Appointment           │
                         │ Notification          │
                         │ Authentication        │
                         │ Analytics              │
                         └──────┬────────┬───────┘
                                │        │
                         ┌──────▼───┐ ┌──▼──────┐
                         │PostgreSQL│ │  Redis  │
                         └──────────┘ └─────────┘
                                │
                         ┌──────▼───────────┐
                         │ Notification      │
                         │ Processing        │
                         └──────┬───────────┘
                                │
                         ┌──────▼───────────┐
                         │ SMS / Email       │
                         │ Provider          │
                         └───────────────────┘
```

---

# 6. Repository Structure

Recommended monorepo:

```text
queueflow/
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── ui/
│   ├── types/
│   └── config/
│
├── infrastructure/
│   ├── docker/
│   ├── helm/
│   └── terraform/
│
├── docs/
│   ├── product-requirements.md
│   ├── architecture.md
│   ├── domain-model.md
│   ├── queue-engine.md
│   ├── appointment-engine.md
│   ├── notification-system.md
│   ├── database-design.md
│   ├── api-specification.md
│   ├── security.md
│   ├── ui-specification.md
│   └── adr/
│
├── README.md
├── AGENTS.md
└── docker-compose.yml
```

The exact repository layout can be changed during implementation if the chosen build tooling benefits from a different structure.

---

# 7. Major Modules

The backend should have explicit modules:

```text
tenant
location
service
staff
customer
queue
appointment
notification
authentication
authorization
display
analytics
billing
audit
```

For MVP, billing can be stubbed or deferred.

The queue module must own queue state transitions.

Controllers should not directly manipulate queue persistence.

Recommended flow:

```text
QueueController
    ↓
QueueApplicationService
    ↓
QueueDomain
    ↓
QueueRepository
```

---

# 8. Tenant Model

QueueFlow is multi-tenant.

A tenant represents a business/customer organization.

Example:

```text
Tenant
 ├── Locations
 ├── Users
 ├── Services
 ├── Staff
 ├── Customers
 ├── Queues
 └── Appointments
```

Every tenant-owned record must have a clear tenant ownership path.

Tenant isolation must be enforced server-side.

Never trust a tenant ID supplied by the browser.

---

# 9. Location Model

A tenant can have multiple physical locations.

Example:

```text
Joe's Barbers
 ├── Christchurch
 ├── Rolleston
 └── Rangiora
```

Each location can have:

- address
- timezone
- opening hours
- holidays
- services
- staff
- queues
- displays
- QR codes

All time calculations must use the location timezone.

Do not assume UTC for business scheduling logic.

Persist timestamps in UTC where practical, but calculate business-local schedules in the location timezone.

---

# 10. Service Model

A service represents something the business provides.

Examples:

```text
Haircut
Haircut + Beard
Kids Haircut
Vehicle Inspection
General Enquiry
Document Submission
```

Service fields should include:

- id
- tenant_id
- location_id
- name
- description
- duration_minutes
- active
- queue_enabled
- appointment_enabled
- priority
- display_order

A service should not contain queue-specific state.

---

# 11. Staff Model

Staff belong to a tenant and can be associated with one or more locations.

Staff may support one or more services.

Example:

```text
Staff
 ├── John
 │    ├── Haircut
 │    └── Beard
 │
 └── Sarah
      └── Haircut
```

Potential future capabilities:

- staff working hours
- breaks
- leave
- service capability
- maximum concurrent service
- location assignment

---

# 12. Customer Model

Customers should not need an account to join a queue.

Minimal customer data:

```text
Customer
- id
- tenant_id
- first_name
- phone_number
- email (optional)
- created_at
- updated_at
```

Do not collect unnecessary personal information.

A customer can have:

- active queue entries
- historical queue entries
- appointments

Customer access to their own tickets should use secure opaque tokens rather than sequential database IDs.

---

# 15. QR Context Domain

The QR Context domain is a foundational platform capability.

It must remain independent from the queue domain.

## 13.1 QR Code

Suggested fields:

```text
id
tenant_id
location_id
public_code
context_type
context_id
name
active
created_at
updated_at
```

The exact schema can evolve, but the QR code should resolve through an opaque public code.

Example:

```text
/q/8F72KJ...
```

The public code should not expose internal IDs or sensitive information.

## 13.2 Context Type

Initial supported types:

```text
GENERAL
LOCATION
QUEUE
SERVICE
TABLE
APPOINTMENT
KIOSK
COUNTER
```

Future types:

```text
PRODUCT
ORDER
PAYMENT
VEHICLE
ROOM
DESK
EVENT
```

Do not create unnecessary context types until there is a real use case.

## 13.3 Capability Model

A context can expose capabilities.

Example:

```text
TABLE-12

VIEW_MENU
ORDER
CALL_STAFF
REQUEST_BILL
PAY
```

Another:

```text
HAIRCUT-QUEUE

JOIN_QUEUE
BOOK_APPOINTMENT
```

Potential model:

```text
context
context_capability
capability
```

However, avoid over-generalizing the database too early. The initial implementation can use a typed context plus configuration while preserving the conceptual separation.

## 13.4 Context Resolution

The resolver receives:

```text
public QR code
```

and returns:

```text
tenant
location
context type
context identifier
enabled capabilities
branding
public configuration
```

Example response:

```json
{
  "business": {
    "name": "Joe's Restaurant"
  },
  "location": {
    "name": "Christchurch"
  },
  "context": {
    "type": "TABLE",
    "displayName": "Table 12"
  },
  "capabilities": ["VIEW_MENU", "ORDER", "CALL_STAFF", "REQUEST_BILL", "PAY"]
}
```

The resolver must not return sensitive administrative data.

## 13.5 QR Lifecycle

QR codes can be:

```text
ACTIVE
DISABLED
REVOKED
```

A business administrator can:

- create QR
- associate QR with a context
- rename QR
- deactivate QR
- regenerate QR
- download QR
- generate printable materials

Printed QR codes should remain stable where possible.

If a business needs to change what a QR does, prefer changing its context/configuration rather than requiring new printed materials.

---

# 16. Capability Architecture

The platform should be organized around reusable business capabilities.

Initial capabilities:

```text
QUEUE
APPOINTMENT
```

Future capabilities:

```text
ORDERING
MENU
STAFF_REQUEST
BILLING
PAYMENT
FORMS
LOYALTY
```

A capability should own its business logic.

For example:

```text
queue/
appointment/
ordering/
payment/
```

The QR Context platform only determines which capability entry points are available.

It should not contain ordering or payment logic.

## 14.1 Capability flow

```text
Customer scans QR
        ↓
Resolve context
        ↓
Load capabilities
        ↓
Customer selects action
        ↓
Capability application service
        ↓
Capability domain
```

Example:

```text
TABLE-12
   ↓
ORDER
   ↓
OrderingApplicationService
   ↓
OrderDomain
```

## 14.2 Capability isolation

The following should remain independent:

```text
QR Context
Queue
Appointments
Ordering
Payments
Notifications
```

They may reference shared entities such as:

```text
Tenant
Location
Customer
```

but should not directly manipulate each other's internal state.

# 15. Queue Model

A queue belongs to a location and may optionally be associated with a service.

Examples:

```text
General Queue
Haircut Queue
Beard Queue
Reception Queue
```

Queue configuration:

- name
- description
- location
- service
- active/inactive
- queue policy
- notification settings
- estimated wait configuration
- maximum queue size
- operating hours

---

# 16. Queue Entry

A queue entry represents one customer waiting for service.

Suggested fields:

```text
id
queue_id
customer_id
service_id
ticket_number
public_token
status
priority
joined_at
called_at
started_at
completed_at
cancelled_at
estimated_wait_seconds
created_at
updated_at
version
```

Do not use a stored `position` as the source of truth.

Position should generally be derived from:

- queue
- state
- ordering
- priority
- eligibility rules

A stored position can become stale.

---

# 17. Queue State Machine

Initial states:

```text
CREATED
   ↓
WAITING
   ↓
CALLED
   ↓
SERVING
   ↓
COMPLETED
```

Alternative paths:

```text
WAITING → CANCELLED

WAITING → SKIPPED

CALLED → NO_SHOW

CALLED → WAITING        (recall/requeue)

SERVING → COMPLETED
```

All transitions must be validated.

Invalid transitions must fail cleanly.

Example:

```text
COMPLETED → WAITING
```

should not be allowed unless an explicit administrative correction workflow is introduced later.

---

# 18. Queue Ordering

MVP should support FIFO:

```text
oldest eligible WAITING entry first
```

The design must allow future policies.

Potential policies:

- FIFO
- priority
- service-specific
- appointment priority
- staff-specific
- configurable business rules

Do not hard-code queue ordering into SQL scattered across the application.

Create a queue selection policy abstraction.

---

# 19. Joining a Queue

Customer flow:

```text
Scan QR
 ↓
Resolve QR destination
 ↓
Show business/location/service
 ↓
Select service if necessary
 ↓
Enter first name
 ↓
Enter mobile
 ↓
Accept required terms/notification consent
 ↓
Join queue
 ↓
Create queue entry
 ↓
Return ticket URL
```

The response should contain:

- ticket identifier/token
- ticket number
- queue name
- current position
- estimated wait
- status
- customer-facing URL

Example:

```json
{
  "ticketNumber": "A42",
  "position": 6,
  "estimatedWaitMinutes": 35,
  "status": "WAITING",
  "ticketUrl": "/queue/t/..."
}
```

---

# 20. Prevent Queue Abuse

Implement protections such as:

- rate limiting
- CAPTCHA or equivalent where abuse occurs
- optional SMS verification
- configurable maximum active tickets per customer
- duplicate detection
- queue capacity limits

Default rule should prevent a customer from creating unlimited active entries.

---

# 21. QR Code System

QR codes should resolve to opaque QueueFlow routes.

Example:

```text
/q/JB-CHCH
```

or a random identifier.

A QR destination may represent:

- business
- location
- service
- queue
- campaign/promotion

Example:

```text
/q/{publicCode}
```

The backend resolves the code.

Do not encode sensitive information into the QR code.

---

# 22. Barcode Support

Barcode support should resolve through the same destination mechanism.

The system should not care whether the input came from:

- QR scan
- barcode scan
- manually entered code
- NFC
- future scanner hardware

All should resolve to a public queue destination.

---

# 23. Physical Queue Cards

The business can generate printable queue cards.

Each card can contain:

- business branding
- QR code
- barcode
- short code
- instructions

Example:

```text
SCAN TO JOIN THE QUEUE

[ QR CODE ]

Or enter:
QF-8F7D92
```

The QR/barcode should be associated with a location or service.

---

# 24. Customer Queue Page

The customer ticket page should show:

```text
Joe's Barbers

You're in the queue

#42

6 people ahead

Estimated wait
~35 minutes

Status
Waiting

[Leave Queue]
```

The page should update without refresh.

Potential future information:

- currently serving ticket
- business instructions
- map/location
- opening hours
- service information

---

# 25. Realtime Updates

Use SSE initially.

Example:

```http
GET /api/public/queue-tickets/{token}/events
```

Events:

```text
POSITION_CHANGED
QUEUE_CALLED
QUEUE_DELAYED
QUEUE_PAUSED
QUEUE_RESUMED
TICKET_CANCELLED
SERVICE_STARTED
SERVICE_COMPLETED
```

The customer frontend subscribes to the ticket stream.

If SSE disconnects, the frontend should:

1. reconnect automatically
2. fetch the current ticket state
3. resume event streaming

Never rely on the client having received every event.

The database/current state remains authoritative.

---

# 26. Staff Queue Dashboard

Main staff screen:

```text
Current Queue

#42  John       Haircut       WAITING
#43  Sarah      Beard         WAITING
#44  Mike       Haircut       WAITING
#45  Lisa       Haircut       WAITING
```

Primary action:

```text
CALL NEXT
```

Current customer:

```text
#41
Jane

[Start Service]
[Complete]
[No Show]
[Recall]
[Cancel]
```

The dashboard must update in realtime.

---

# 27. Call Next

When staff presses `Call Next`:

1. Lock/select next eligible entry.
2. Verify queue is active.
3. Verify there isn't an invalid active state.
4. Transition selected entry to `CALLED`.
5. Record `called_at`.
6. Publish domain event.
7. Trigger notifications.
8. Update staff dashboards.
9. Update public display.
10. Update customer ticket page.

The operation must be concurrency-safe.

Two staff members must not receive the same queue entry.

Use appropriate database locking/optimistic locking.

---

# 28. Skip / No Show / Recall

Staff operations:

### Skip

Temporarily move customer out of active ordering.

### No Show

Customer is considered absent.

### Recall

Notify/call customer again.

### Requeue

Move a skipped/temporarily absent customer back into the waiting queue.

Every operation must create an audit/event record.

---

# 29. Public Queue Display

A browser can be placed on a TV/monitor.

Route:

```text
/display/{publicDisplayCode}
```

Display:

```text
JOE'S BARBERS

NOW SERVING

#42

PLEASE PROCEED

NEXT
#43
```

Support multiple counters:

```text
Counter 1   #42
Counter 2   #45
Counter 3   #48
```

The display should not expose customer names or phone numbers by default.

---

# 30. SMS Notification System

Notifications must be decoupled from queue operations.

Queue domain:

```text
QueueEntryCalled
```

Notification system:

```text
NotificationRequested
```

Provider:

```text
SMS Provider
```

Initial notification types:

- queue joined
- approaching turn
- called
- appointment confirmation
- appointment reminder
- appointment cancellation

Business configuration should control which notifications are enabled.

---

# 31. SMS Thresholds

Businesses should be able to configure thresholds.

Example:

```text
5 people ahead → approaching notification

2 people ahead → nearly next notification

Called → turn notification
```

Avoid sending repeated notifications for the same threshold.

Notification state should be persisted.

Example:

```text
APPROACHING_SENT
NEARLY_NEXT_SENT
CALLED_SENT
```

---

# 32. Notification Provider Abstraction

Use an interface:

```java
interface NotificationProvider {
    NotificationResult send(NotificationRequest request);
}
```

Implementations can include:

```text
MockNotificationProvider
SmsProvider
EmailProvider
```

Do not couple the queue domain to a specific SMS vendor.

---

# 33. Appointment System

Appointment flow:

```text
Business
 ↓
Service
 ↓
Staff/resource
 ↓
Working hours
 ↓
Availability
 ↓
Customer selects slot
 ↓
Appointment created
```

Appointment fields:

```text
id
tenant_id
location_id
service_id
staff_id
customer_id
start_time
end_time
status
created_at
updated_at
```

Statuses:

```text
BOOKED
CONFIRMED
CHECKED_IN
IN_SERVICE
COMPLETED
CANCELLED
NO_SHOW
```

---

# 34. Availability Engine

Availability must consider:

- business opening hours
- staff availability
- service duration
- breaks
- holidays
- existing appointments
- staff-service assignments
- location timezone
- booking limits

Do not generate availability solely in the frontend.

The backend must be authoritative.

---

# 35. Appointment Booking

Customer flow:

```text
Select service
 ↓
Select staff (optional)
 ↓
Select date
 ↓
Get available slots
 ↓
Select time
 ↓
Enter customer details
 ↓
Confirm
```

Prevent double booking with database-level concurrency protection.

Do not rely only on frontend availability.

---

# 36. Appointment Check-In

When customer arrives:

```text
Appointment
 ↓
Check In
 ↓
Queue Entry
```

The resulting queue entry should retain a reference to the appointment.

Example:

```text
queue_entry.appointment_id
```

This allows analytics to distinguish:

- walk-ins
- appointments

---

# 37. Mixed Queue

The queue engine should support:

```text
Walk-in
Walk-in
Appointment
Walk-in
Appointment
```

MVP can treat appointments as normal queue entries after check-in.

Later, configurable priority can be introduced.

---

# 38. Estimated Wait Time

MVP calculation:

```text
estimated wait =
eligible people ahead × average service duration
```

For multiple staff:

```text
estimated wait =
estimated workload ahead / active service capacity
```

Future model can incorporate:

- historical duration
- service type
- staff speed
- active staff
- current service progress
- queue priority

Estimated wait must always be labelled as an estimate.

Do not imply exact timing.

---

# 39. Business Hours

Model business hours separately from appointment availability.

Example:

```text
Monday
09:00–17:00

Tuesday
09:00–17:00

Saturday
09:00–13:00
```

Support split periods:

```text
09:00–12:00
13:00–17:00
```

Support holidays and exceptional closures.

---

# 40. Roles and Permissions

Initial roles:

```text
PLATFORM_ADMIN

TENANT_OWNER

TENANT_ADMIN

MANAGER

STAFF

DISPLAY_ONLY
```

Example permissions:

```text
TENANT_OWNER
- all tenant permissions

TENANT_ADMIN
- business configuration
- staff
- services
- queues
- appointments
- analytics

MANAGER
- queue
- appointments
- staff operational controls

STAFF
- queue operations
- appointment check-in
- service completion

DISPLAY_ONLY
- public display only
```

Use permission-based authorization internally even if roles are the initial UI representation.

---

# 41. Authentication

Staff/admin authentication should support:

MVP:

- email/password
- secure session/token handling

Later:

- passkeys
- Google
- Microsoft
- SSO
- MFA

Customer authentication is optional.

For customer self-service, use short-lived verification mechanisms such as OTP where necessary.

---

# 42. Security Requirements

## Tenant isolation

Every tenant-owned operation must validate tenant context.

## Authorization

Every staff/admin endpoint must verify permissions.

## Public tokens

Use cryptographically random tokens.

Do not use sequential IDs as public access credentials.

## Rate limiting

Apply to:

- queue join
- OTP
- login
- appointment creation
- public API
- QR resolution

## Input validation

Validate all request payloads.

Use strict DTOs.

## Audit logging

Record administrative and important queue actions.

Examples:

```text
QUEUE_ENTRY_CALLED
QUEUE_ENTRY_SKIPPED
QUEUE_ENTRY_CANCELLED
QUEUE_ENTRY_COMPLETED
APPOINTMENT_CANCELLED
USER_ROLE_CHANGED
SERVICE_UPDATED
```

---

# 43. Privacy

The system handles phone numbers and potentially names.

Requirements:

- collect only necessary information
- define retention periods
- provide customer deletion capability where appropriate
- avoid exposing phone numbers publicly
- avoid exposing customer names on public displays by default
- secure logs so PII is not unnecessarily written
- document notification consent
- protect exported analytics

Privacy requirements should be reviewed against applicable New Zealand privacy obligations before production launch.

---

# 44. Database Design

Initial tables:

```text
tenant
tenant_user

location
business_hours
holiday

service
staff
staff_service
staff_availability

customer

queue
queue_entry
queue_event

appointment

notification
notification_template

qr_code
public_display

audit_event
```

Future:

```text
subscription
invoice
payment
webhook
integration
```

---

# 45. Database Constraints

Important constraints:

- tenant foreign keys
- location belongs to tenant
- service belongs to tenant/location
- staff belongs to tenant
- queue belongs to location
- customer belongs to tenant
- appointment belongs to tenant
- queue entry belongs to queue/customer/tenant
- public tokens unique
- QR codes unique
- notification idempotency key unique where required

Use indexes for:

```text
queue_id + status
queue_id + joined_at
customer_id + status
location_id
appointment start_time
notification status
```

---

# 46. Concurrency

Queue operations are concurrency-sensitive.

The implementation must handle:

```text
Staff A clicks Call Next
Staff B clicks Call Next
```

at almost the same time.

Only one queue entry can be selected.

Possible approaches:

- PostgreSQL row locking
- `SELECT ... FOR UPDATE SKIP LOCKED`
- optimistic locking
- transactional state transition

The selected approach must be documented in `queue-engine.md`.

Add concurrent integration tests.

---

# 47. Idempotency

Operations that may be retried must be idempotent.

Examples:

```text
Call next
Appointment creation
Notification sending
Queue join
```

Especially important for:

- browser retries
- network timeouts
- provider retries
- background workers

Use idempotency keys where appropriate.

---

# 48. API Design

Example endpoints:

## Public

```http
GET  /api/public/qr/{code}
POST /api/public/queues/{queueId}/entries
GET  /api/public/tickets/{token}
GET  /api/public/tickets/{token}/events
POST /api/public/tickets/{token}/cancel
```

## Staff

```http
GET  /api/staff/queues/{queueId}
POST /api/staff/queues/{queueId}/call-next
POST /api/staff/queue-entries/{id}/start
POST /api/staff/queue-entries/{id}/complete
POST /api/staff/queue-entries/{id}/skip
POST /api/staff/queue-entries/{id}/recall
POST /api/staff/queue-entries/{id}/no-show
```

## Appointments

```http
GET  /api/public/locations/{id}/availability
POST /api/public/appointments
GET  /api/public/appointments/{token}
POST /api/public/appointments/{token}/cancel
POST /api/staff/appointments/{id}/check-in
```

## Admin

```http
GET/POST/PATCH /api/admin/services
GET/POST/PATCH /api/admin/staff
GET/POST/PATCH /api/admin/queues
GET/POST/PATCH /api/admin/locations
GET/POST/PATCH /api/admin/business-hours
```

Use consistent response/error formats.

---

# 49. API Error Model

Use a standard structure:

```json
{
  "code": "QUEUE_NOT_ACTIVE",
  "message": "The queue is currently closed.",
  "correlationId": "..."
}
```

Do not expose stack traces.

Use stable machine-readable error codes.

---

# 50. Realtime API

Customer:

```text
GET /api/public/tickets/{token}/events
```

Staff:

```text
GET /api/staff/queues/{queueId}/events
```

Display:

```text
GET /api/public/displays/{code}/events
```

All streams should support reconnect.

---

# 51. UI Routes

## Public

```text
/
 /q/{code}
 /queue/t/{token}
 /appointment
 /appointment/{token}
```

## Staff

```text
/admin
/admin/queue
/admin/appointments
/admin/customers
/admin/staff
/admin/services
/admin/locations
/admin/settings
/admin/analytics
```

## Display

```text
/display/{code}
```

---

# 52. Customer UI Requirements

The customer UI must be:

- mobile-first
- responsive
- fast
- accessible
- usable without an account

Primary states:

```text
Join Queue
Waiting
Approaching
Called
Serving
Completed
Cancelled
No Show
```

Avoid exposing internal state names directly to customers.

Use friendly language.

---

# 53. Staff UI Requirements

Staff UI should optimize for speed.

Primary controls must be obvious:

```text
CALL NEXT
START
COMPLETE
NO SHOW
RECALL
SKIP
```

Avoid complex navigation while staff are operating a live queue.

Queue should remain visible while operating.

---

# 54. Public Display Requirements

Display mode should:

- work full screen
- hide admin controls
- hide customer PII
- reconnect automatically
- work on common browsers/TV devices
- update in realtime
- provide a fallback if disconnected

---

# 55. Accessibility

Target WCAG 2.1 AA or current equivalent requirements as practical.

Include:

- keyboard navigation
- focus states
- sufficient contrast
- accessible form labels
- screen reader support
- non-colour-only status indicators
- large touch targets

---

# 56. Analytics

MVP analytics:

```text
customers served
average wait
average service duration
queue abandonment
no-shows
appointments
walk-ins
peak periods
```

Analytics should distinguish:

```text
walk-in
appointment
```

Future metrics:

- staff utilization
- service-level compliance
- queue capacity
- customer return rate
- notification delivery
- wait-time accuracy

---

# 57. Audit Trail

Audit important operations.

Example:

```text
audit_event

id
tenant_id
actor_user_id
event_type
entity_type
entity_id
metadata
created_at
```

Do not store unnecessary sensitive information in metadata.

---

# 58. Notification Reliability

Notification sending should not block queue operations.

Bad:

```text
Call Next
 ↓
Send SMS synchronously
 ↓
Save queue state
```

Preferred:

```text
Transaction
 ├── update queue state
 └── create notification request/outbox
           ↓
       background worker
           ↓
       SMS provider
```

For MVP, an internal background worker can be sufficient.

---

# 59. Transactional Outbox

Introduce an outbox table if asynchronous notifications are required.

Example:

```text
outbox_event

id
aggregate_type
aggregate_id
event_type
payload
status
created_at
processed_at
retry_count
```

Flow:

```text
DB transaction
 ├── update queue_entry
 └── insert outbox event

Worker
 ↓
read event
 ↓
send notification
 ↓
mark processed
```

This prevents the classic problem:

```text
queue updated
SMS event lost
```

---

# 60. SMS Provider

Implement provider abstraction.

Development:

```text
Mock SMS provider
```

Testing:

```text
WireMock/MockServer
```

Production:

```text
External SMS provider
```

The exact provider should be selected later based on:

- New Zealand delivery
- pricing
- sender ID support
- API reliability
- compliance
- throughput

---

# 61. Testing Strategy

Testing is a first-class requirement.

## Unit tests

Test:

- queue state machine
- queue ordering
- position calculation
- estimated wait
- appointment availability
- notification thresholds
- authorization rules

## Integration tests

Use Testcontainers for:

- PostgreSQL
- Redis where needed

Test:

- concurrent queue operations
- database constraints
- tenant isolation
- appointment conflicts
- outbox processing

## API tests

Test:

- successful requests
- validation errors
- authorization
- tenant isolation
- idempotency
- rate limiting

## E2E tests

Use Playwright.

Critical journey:

```text
Scan QR
 → Join queue
 → View ticket
 → Staff calls next
 → Customer sees called state
 → Staff completes
 → Customer sees completed
```

Appointment journey:

```text
Select service
 → Select date
 → Select slot
 → Book
 → Check in
 → Queue
 → Complete
```

---

# 62. Security Testing

Include tests for:

- IDOR
- tenant escape
- privilege escalation
- public token guessing
- rate limit bypass
- malformed payloads
- XSS
- CSRF where applicable
- authentication bypass
- unauthorized queue operations

Use dependency/security scanning in CI.

---

# 63. CI/CD

Pipeline should include:

```text
format
lint
compile
unit tests
integration tests
API tests
frontend tests
E2E tests
dependency scanning
container scanning
build
```

Quality gates should prevent deployment if required tests fail.

---

# 64. Local Development

Docker Compose should provide:

```text
postgres
redis
api
web
```

Optional:

```text
mock SMS provider
mail catcher
```

Provide one-command startup.

Example:

```bash
docker compose up
```

Seed development data:

```text
Joe's Barbers
Christchurch
Haircut
Haircut + Beard
2 staff
1 queue
```

---

# 65. Observability

Backend should provide:

- structured logs
- correlation IDs
- metrics
- health endpoints
- readiness/liveness
- tracing-ready architecture

Metrics:

```text
queue_entries_created_total
queue_entries_completed_total
queue_wait_seconds
service_duration_seconds
appointments_created_total
notifications_sent_total
notifications_failed_total
```

---

# 66. Operational Dashboards

Operational metrics should be usable by monitoring systems.

Potential dashboards:

### Queue

- active queues
- active customers
- average wait
- queue abandonment

### Notification

- SMS sent
- SMS failed
- provider latency

### API

- request rate
- latency
- errors

---

# 67. Deployment Architecture

Production should support:

```text
Load Balancer
      ↓
Next.js
      ↓
Spring Boot instances
      ↓
PostgreSQL
      ↓
Redis
```

Multiple API instances must be safe.

Do not store important queue state only in local memory.

Realtime infrastructure must work when multiple backend instances exist.

---

# 68. Realtime Scaling

With multiple API instances, SSE clients may connect to different instances.

Database state remains authoritative.

Redis can be used as a pub/sub mechanism if required:

```text
Queue update
 ↓
DB transaction
 ↓
Publish event
 ↓
Redis Pub/Sub
 ↓
API instances
 ↓
SSE clients
```

This should only be introduced when multiple-instance realtime behaviour requires it.

---

# 69. QR/Barcode Administration

Admin should be able to:

- create QR destination
- associate QR with location
- associate QR with service
- deactivate QR
- regenerate QR
- download printable QR
- generate printable queue cards

QR destination should remain stable where possible so printed material doesn't need constant replacement.

---

# 70. Business Configuration

Admin settings:

```text
Business name
Logo
Address
Timezone

Queue:
- FIFO/priority
- maximum capacity
- notification thresholds
- estimated wait settings

Appointments:
- advance booking window
- cancellation window
- reminder timing
- slot duration

Notifications:
- SMS enabled
- email enabled
- templates
```

---

# 71. Customer Cancellation

Customer should be able to leave a queue.

Example:

```text
[Leave Queue]
```

Confirm:

```text
Are you sure you want to leave the queue?
```

After cancellation:

```text
Your queue ticket has been cancelled.
```

A customer should not be able to cancel another customer's ticket using a public URL.

---

# 72. Queue Pause

Businesses may need to temporarily stop accepting customers.

States:

```text
ACTIVE
PAUSED
CLOSED
```

When paused:

- existing customers remain visible
- new joins can be blocked
- customer should receive clear information

Example:

```text
Queue temporarily paused.
Please try again shortly.
```

---

# 73. Queue Capacity

Allow configuration:

```text
Maximum active customers: 30
```

When full:

```text
The queue is currently full.
Please try again later.
```

Future feature:

```text
Join waitlist
```

---

# 74. Service Availability

A service can be:

```text
ACTIVE
INACTIVE
```

A service can also be unavailable temporarily.

Example:

```text
Haircut
Available

Beard Trim
Currently unavailable
```

Customers should not be able to join inactive services.

---

# 75. Appointment Reminder System

Configurable reminders:

```text
24 hours before
2 hours before
30 minutes before
```

Do not hard-code these.

The notification scheduler must be idempotent.

---

# 76. Appointment Cancellation

Business configuration:

```text
Cancellation allowed:
Yes

Minimum notice:
2 hours
```

Customer cancellation must enforce the rule server-side.

---

# 77. Appointment No-Show

If the customer does not check in:

```text
BOOKED
 ↓
NO_SHOW
```

The business can configure a grace period.

Example:

```text
Appointment 10:00
Grace period 10 minutes
```

---

# 78. Customer Check-In

Possible methods:

1. Staff checks in customer.
2. Customer scans appointment QR.
3. Customer opens appointment link and checks in.
4. Future kiosk support.

The check-in operation must be idempotent.

---

# 79. Kiosk/Future Hardware

The architecture should leave room for:

```text
Tablet kiosk
Barcode scanner
Receipt printer
NFC
Physical ticket printer
```

But these are not MVP requirements.

The kiosk can use the same public/customer APIs.

---

# 80. Internationalization

Initial market can be New Zealand.

Still design for:

- timezone
- locale
- currency
- date format
- phone number normalization
- language

Do not hard-code NZ-specific assumptions into core queue logic.

---

# 81. Billing

Defer billing until core product validation.

Future model:

```text
Subscription
 ├── Plan
 ├── Tenant
 ├── Usage
 └── Invoice
```

Potential usage:

- locations
- staff
- monthly queue entries
- SMS messages
- appointments

SMS may be metered separately.

---

# 82. Webhooks

Future integration API:

```text
queue.entry.created
queue.entry.called
queue.entry.completed
queue.entry.cancelled

appointment.created
appointment.cancelled
appointment.checked_in
appointment.completed
```

Webhook requirements:

- signing secret
- retries
- idempotency
- delivery status
- dead-letter handling

---

# 83. API Versioning

Start with:

```text
/api/v1/
```

Even if the application is small.

Avoid breaking external integrations later.

---

# 84. Documentation

Repository documentation should include:

```text
README.md
AGENTS.md
docs/architecture.md
docs/domain-model.md
docs/queue-engine.md
docs/appointment-engine.md
docs/api-specification.md
docs/database-design.md
docs/security.md
docs/ui-specification.md
docs/deployment.md
docs/adr/*
```

Do not maintain a giant historical progress file.

Use concise implementation status documents or Git history instead.

---

# 85. Architecture Decision Records

Create ADRs for important decisions:

```text
ADR-001 Modular monolith
ADR-002 PostgreSQL
ADR-003 SSE for realtime
ADR-004 QR public token design
ADR-005 Queue concurrency strategy
ADR-006 Notification outbox
ADR-007 Customer authentication strategy
ADR-008 Multi-tenancy strategy
ADR-009 Appointment availability strategy
```

Each ADR should contain:

- context
- decision
- alternatives
- consequences

---

# 86. MVP Scope

MVP must include:

## Business

- tenant
- one or more locations
- services
- basic staff

## Queue

- create queue
- generate QR
- join queue
- ticket page
- live position
- staff queue dashboard
- call next
- complete
- skip
- no-show
- cancel
- queue pause/close

## Display

- public display
- current ticket
- next ticket

## Notifications

- SMS abstraction
- mock provider
- called notification
- configurable approaching notification

## Security

- authentication
- RBAC
- tenant isolation
- rate limiting
- audit logging

## Infrastructure

- PostgreSQL
- Docker Compose
- automated tests
- CI pipeline

---

# 87. MVP Exclusions

Do not implement initially:

- native mobile apps
- payments
- subscriptions
- complex AI wait prediction
- Kafka
- microservices
- advanced priority rules
- complex POS integrations
- complex CRM
- advanced marketing
- loyalty system
- multi-language UI
- physical ticket printers
- NFC

These can be future phases.

---

# 88. Implementation Roadmap

## Phase 0 — Repository and Architecture

Deliver:

- monorepo
- README
- AGENTS.md
- architecture.md
- local Docker Compose
- backend skeleton
- frontend skeleton
- CI skeleton
- PostgreSQL connection
- database migration framework

Acceptance:

- project starts locally
- API health endpoint works
- frontend loads
- database migration runs
- CI executes

---

## Phase 1 — Identity and Tenant

Implement:

- tenant
- users
- roles
- authentication
- authorization
- tenant isolation

Acceptance:

- admin can log in
- user can only access authorized tenant
- unauthorized tenant access is rejected
- role permissions are tested

---

## Phase 2 — Locations and Services

Implement:

- location
- services
- staff
- staff-service assignment
- business hours

Acceptance:

- admin can create/edit services
- staff can be associated with services
- services can be enabled/disabled
- locations have timezone

---

## Phase 3 — Queue Domain

Implement:

- queue
- queue entry
- queue state machine
- FIFO ordering
- ticket number
- queue events
- concurrency control

Acceptance:

- customer can join
- duplicate active queue entries are controlled
- queue position is correct
- concurrent Call Next cannot select the same customer
- invalid transitions fail

---

## Phase 4 — Customer Queue UI

Implement:

- QR landing page
- service selection
- customer details
- join queue
- ticket page
- leave queue
- realtime position

Acceptance:

```text
Scan QR
→ Select service
→ Join
→ Receive ticket
→ Position changes live
→ Cancel works
```

---

## Phase 5 — Staff Queue UI

Implement:

- queue dashboard
- Call Next
- Start
- Complete
- Skip
- Recall
- No Show
- Cancel
- pause/resume

Acceptance:

- staff can operate complete queue lifecycle
- updates are reflected to customer
- updates are reflected to display
- concurrency tests pass

---

## Phase 6 — Public Display

Implement:

- display route
- public display token
- realtime updates
- fullscreen-friendly UI

Acceptance:

- display can run independently
- current ticket updates live
- no customer PII is exposed
- reconnect works

---

## Phase 7 — Notification Infrastructure

Implement:

- notification domain
- notification templates
- SMS abstraction
- mock provider
- outbox
- retry handling
- idempotency

Acceptance:

- called customer receives exactly one notification
- failed notification is retried
- duplicate processing does not duplicate SMS
- queue operation does not depend on SMS provider availability

---

## Phase 8 — Real SMS

Implement:

- production SMS provider adapter
- provider configuration
- delivery status
- provider error handling
- usage tracking

Acceptance:

- test message delivered
- provider failure handled
- secrets are not logged
- notification metrics available

---

## Phase 9 — Appointment Engine

Implement:

- appointment
- availability
- staff schedules
- service duration
- booking
- cancellation
- appointment confirmation

Acceptance:

- valid slots are returned
- overlapping bookings are prevented
- appointment cancellation rules work
- timezone behaviour is tested

---

## Phase 10 — Appointment Check-In and Queue Integration

Implement:

- check-in
- appointment → queue entry
- appointment reference on queue entry
- walk-in/appointment distinction

Acceptance:

```text
Appointment
→ Check in
→ Queue
→ Call
→ Complete
```

works end-to-end.

---

## Phase 11 — Analytics

Implement:

- daily metrics
- wait time
- service time
- customers served
- cancellations
- no-shows
- appointments vs walk-ins

Acceptance:

- analytics match underlying queue events
- tenant isolation applies to reports

---

## Phase 12 — Business Administration

Implement:

- business branding
- QR management
- staff management
- queue settings
- notification settings
- appointment settings
- holiday management

Acceptance:

- business can configure the complete MVP without database access

---

## Phase 13 — Hardening

Implement:

- security review
- performance testing
- rate limiting
- audit review
- dependency scanning
- accessibility review
- backup/recovery procedure
- operational dashboards

Acceptance:

- security tests pass
- performance targets are documented
- production readiness checklist completed

---

## Phase 14 — SaaS/Billing

Only after product validation:

- plans
- subscriptions
- usage
- billing
- tenant limits
- Stripe/payment integration if selected

---

# 89. Suggested Codex Execution Strategy

Codex should not attempt the entire project in one task.

Use phases.

For each phase:

1. Read `AGENTS.md`.
2. Read relevant architecture documents.
3. Inspect existing implementation.
4. Create/update a short implementation plan.
5. Implement the phase.
6. Run tests.
7. Fix failures.
8. Update documentation.
9. Keep changes focused.
10. Commit when appropriate.

Do not rewrite unrelated modules during a phase.

---

# 90. Definition of Done

A phase is not complete merely because code compiles.

Every phase must have:

- implementation
- unit tests
- integration tests where appropriate
- frontend tests where appropriate
- API tests
- documentation
- migration scripts
- error handling
- security consideration
- acceptance criteria verification

The final implementation should pass:

```text
Build
Lint
Unit tests
Integration tests
E2E tests
Security checks
```

---

# 91. Coding Standards

Use:

- Clean Code
- SOLID where appropriate
- small cohesive classes
- explicit domain boundaries
- immutable DTOs where practical
- clear naming
- meaningful exceptions
- structured logging
- no hidden global state

Avoid:

- giant service classes
- controllers containing business logic
- duplicated authorization logic
- duplicated queue state transitions
- magic strings
- unnecessary abstractions
- premature microservices

---

# 92. Database Migration Rules

Every schema change must have a migration.

Never manually modify production schema.

Migration naming should be consistent.

Example:

```text
V001__create_tenant.sql
V002__create_location.sql
V003__create_service.sql
V004__create_queue.sql
```

Test migrations from an empty database.

---

# 93. Performance Targets

Initial targets:

- normal API requests: <500ms under expected load
- public queue page initial load: <2s under normal conditions
- queue updates: near realtime
- queue operations should complete within normal interactive web latency
- database operations must remain indexed and bounded

Exact load targets should be established before production.

Benchmark:

- queue joins
- Call Next
- position calculation
- SSE connections
- appointment availability
- notification worker

---

# 94. Failure Handling

Important scenarios:

### Database unavailable

API returns controlled error.

### SMS provider unavailable

Queue operation succeeds; notification is retried.

### Redis unavailable

Core queue functionality should continue if Redis is only used for optional realtime fanout/cache.

### Browser disconnects

Customer reconnects and fetches current state.

### Duplicate request

Idempotency prevents duplicate queue entries or bookings.

### Backend instance restart

Queue state remains in PostgreSQL.

---

# 95. Data Consistency Rules

PostgreSQL is the source of truth for:

- queue state
- appointment state
- customer records
- business configuration

Redis must never become the authoritative store for queue state.

The browser must never be the source of truth.

---

# 96. Future Advanced Features

Potential future roadmap:

## Smart queue prediction

Use historical service durations.

## Dynamic staffing

Recommend additional staff during predicted peak periods.

## Customer self-service

Allow customers to:

- reschedule
- update contact information
- view appointments

## Business integrations

- POS
- CRM
- Google Calendar
- Microsoft 365
- accounting
- webhook integrations

## Mobile apps

Native or PWA applications.

## Kiosk mode

Self-service check-in.

## Enterprise

- SSO
- SCIM
- advanced audit
- data residency
- SLA
- API management

---

# 97. Important Product Decisions to Preserve

These decisions should remain explicit:

1. Customers do not need accounts to join a queue.
2. QR/barcode destinations use opaque public identifiers.
3. PostgreSQL is the authoritative store.
4. Queue state transitions are controlled by the queue domain.
5. Queue operations are concurrency-safe.
6. SMS must not block queue operations.
7. Notifications use an abstraction/provider interface.
8. Appointments and queues are separate concepts but integrate through check-in.
9. Public displays must not expose PII.
10. Multi-tenancy is built into the initial data model.
11. Modular monolith first.
12. SSE first for realtime.
13. Kafka is deferred until there is a real need.
14. Billing is deferred until core product validation.

---

# 98. First End-to-End Vertical Slice

Before implementing every admin feature, establish one complete vertical slice:

```text
Business
 ↓
Location
 ↓
Service
 ↓
Queue
 ↓
QR Code
 ↓
Customer scans
 ↓
Customer joins
 ↓
Queue ticket
 ↓
Staff sees customer
 ↓
Staff calls next
 ↓
Customer receives realtime update
 ↓
Customer receives notification
 ↓
Staff completes
 ↓
Customer sees completed
```

This should be the first major demonstration of the product.

If this vertical slice works reliably, subsequent features can be added around it.

---

# 99. MVP Success Criteria

The MVP should allow a real business to:

1. Create an account/business.
2. Create a location.
3. Create services.
4. Create staff.
5. Create a queue.
6. Generate a QR code.
7. Print/display the QR code.
8. Have a real customer scan it.
9. Customer joins without installing an app.
10. Customer receives a queue ticket.
11. Customer sees their position.
12. Staff sees the customer.
13. Staff calls the customer.
14. Customer sees the call.
15. SMS is sent through the configured provider.
16. Staff completes the service.
17. Customer sees completion.
18. A public display can show the current ticket.

This is the minimum end-to-end product that should be proven before expanding the platform.

---

# 100. Recommended Initial Development Order

```text
1. Repository / tooling
2. Architecture documentation
3. Tenant/authentication
4. Location/service
5. Queue domain
6. Queue database
7. Public QR flow
8. Customer ticket
9. Staff queue
10. Realtime
11. Public display
12. Notification abstraction
13. SMS provider
14. Appointment engine
15. Appointment → queue
16. Analytics
17. Administration
18. Security hardening
19. Deployment
20. Billing
```

Do not reverse the order by starting with billing, complex analytics, or native applications.

---

# 101. Codex Agent Instructions

When implementing this project:

- Read `AGENTS.md` before making changes.
- Treat this document as the product/architecture baseline.
- Do not introduce microservices without an explicit architecture decision.
- Do not add Kafka simply because events exist.
- Do not store queue truth in Redis.
- Do not expose sequential database IDs as public security tokens.
- Do not expose customer phone numbers on public screens.
- Do not place business logic in controllers.
- Do not bypass the queue domain/state machine.
- Do not silently weaken tenant isolation.
- Do not introduce dependencies without documenting why.
- Add tests with every meaningful feature.
- Update relevant documentation when architecture changes.
- Prefer small, reviewable commits.
- Keep generated/status documentation concise.
- Do not maintain a giant cumulative progress file.

When requirements are ambiguous, preserve the existing architecture and ask for clarification only when the ambiguity materially affects correctness or creates irreversible design consequences.

---

# 102. Immediate Next Task for Codex

The first implementation task should be:

> **Create the QueueFlow repository foundation and architecture skeleton.**

Deliver:

```text
apps/api
apps/web
docs
infrastructure
AGENTS.md
README.md
docker-compose.yml
```

The API should:

- start successfully
- connect to PostgreSQL
- expose health/readiness endpoints
- support database migrations
- have a clean module structure

The web application should:

- start successfully
- have basic routing
- have a placeholder customer route
- have a placeholder admin route
- have a placeholder display route

Do not implement the complete queue system in this first task.

The purpose is to establish a clean foundation for the subsequent vertical slices.

---

# 103. Final Architecture Goal

The completed platform should conceptually look like:

```text
                         QUEUEFLOW
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
   CUSTOMER               BUSINESS              DISPLAY
       │                     │                     │
       │                Staff/Admin               │
       │                     │                     │
       └──────────────┬──────┴─────────────────────┘
                      │
                Queue / Appointment
                    Domain
                      │
        ┌─────────────┼──────────────┐
        │             │              │
     Customer       Queue       Appointment
        │             │              │
        └─────────────┼──────────────┘
                      │
                  PostgreSQL
                      │
               Domain Events
                      │
              Notification Layer
                      │
                 SMS / Email
```

The most important architectural principle is:

**The QR Context Platform is the shared physical-world entry point; individual capabilities own their business logic.**

The queue engine is the first major capability, not the architectural root of every future feature.

QR codes, customer pages, staff dashboards, displays, ordering, appointments, payments and future integrations should interact through well-defined context and capability boundaries rather than implementing their own QR/context resolution logic.

The intended long-term model is:

```text
                         QR / BARCODE
                              │
                              ▼
                     QR CONTEXT PLATFORM
                              │
              ┌───────────────┼────────────────┐
              │               │                │
              ▼               ▼                ▼
            QUEUE        APPOINTMENTS      ORDERING
              │               │                │
              └───────────────┼────────────────┘
                              │
                         FUTURE PAYMENT
                              │
                              ▼
                     PAYMENT PROVIDERS
```

The QR layer provides context. The capability modules provide the business workflows.
