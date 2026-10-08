<template>
	<BaseLayout>
		<template #body>
			<div class="flex flex-col items-center my-7 p-4 gap-7">
				<CheckInPanel />
				<QuickLinks :items="quickLinks" :title="__('Quick Links')" />
				<RequestPanel />
			</div>
		</template>
	</BaseLayout>
</template>

<script setup>
import { inject, markRaw, computed } from "vue"

import CheckInPanel from "@/components/CheckInPanel.vue"
import QuickLinks from "@/components/QuickLinks.vue"
import BaseLayout from "@/components/BaseLayout.vue"
import RequestPanel from "@/components/RequestPanel.vue"
import AttendanceIcon from "@/components/icons/AttendanceIcon.vue"
import ShiftIcon from "@/components/icons/ShiftIcon.vue"
// Request Leave / View Salary Slips quick links are hidden for now.
// import LeaveIcon from "@/components/icons/LeaveIcon.vue"
import ExpenseIcon from "@/components/icons/ExpenseIcon.vue"
import EmployeeAdvanceIcon from "@/components/icons/EmployeeAdvanceIcon.vue"
// import SalaryIcon from "@/components/icons/SalaryIcon.vue"
import TaskIcon from "@/components/icons/TaskIcon.vue"

const __ = inject("$translate")
const user = inject("$user")

// Only the Projects Manager role sees this quick link - not even System
// Manager/HR Manager/HR User, unless they also hold it. Matches
// AttendanceRequest.validate_creation_permission() in
// hrms/hr/doctype/attendance_request/attendance_request.py, which is the
// actual enforcement; this only keeps the quick link from being shown.
const canCreateBackdatedTimesheet = computed(() =>
	Boolean(user.data?.roles?.includes("Projects Manager"))
)

const quickLinks = computed(() => {
	const links = [
		{
			icon: markRaw(TaskIcon),
			title: __("Tasks"),
			route: "TaskListView",
		},
	]

	if (canCreateBackdatedTimesheet.value) {
		links.push({
			icon: markRaw(AttendanceIcon),
			title: __("Backdated Timesheet"),
			route: "AttendanceRequestFormView",
		})
	}

	links.push(
		{
			icon: markRaw(ShiftIcon),
			title: __("Request a Shift"),
			route: "ShiftRequestFormView",
		},
		// {
		// 	icon: markRaw(LeaveIcon),
		// 	title: __("Request Leave"),
		// 	route: "LeaveApplicationFormView",
		// },
		{
			icon: markRaw(ExpenseIcon),
			title: __("Claim an Expense"),
			route: "ExpenseClaimFormView",
		},
		{
			icon: markRaw(EmployeeAdvanceIcon),
			title: __("Request an Advance"),
			route: "EmployeeAdvanceFormView",
		}
		// {
		// 	icon: markRaw(SalaryIcon),
		// 	title: __("View Salary Slips"),
		// 	route: "SalarySlipsDashboard",
		// }
	)

	return links
})
</script>
