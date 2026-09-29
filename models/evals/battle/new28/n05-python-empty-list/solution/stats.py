def average(nums):
    """The mean of a list of numbers, or None when there are none."""
    if not nums:
        return None
    return sum(nums) / len(nums)
