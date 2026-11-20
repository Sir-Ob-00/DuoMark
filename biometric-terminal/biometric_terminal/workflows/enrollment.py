"""No authenticated enrollment command-delivery/confirmation HTTP contract exists."""


class Enrollment:
    def run(self):
        # Never mutate Pending/Enrolled locally or impersonate an admin cookie.
        return {"outcome": "enrollment-unavailable",
                "message": "Backend command delivery and trusted confirmation transport are required; enrollment status is unchanged."}
