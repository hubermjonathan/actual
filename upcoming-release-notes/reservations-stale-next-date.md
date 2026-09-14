---
category: Bugfix
authors: [hubermjonathan]
---

Reservations read a schedule's stored next date directly from
`local_next_date`, which is only correct while its timestamp still matches
`base_next_date_ts`. After a schedule's date was changed, claims kept
reserving against the old date. They now resolve it the same way
`v_schedules.next_date` does.
