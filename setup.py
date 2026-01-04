from setuptools import setup, find_packages

with open("README.md", "r") as f:
    long_description = f.read()

setup(
    name="sms_inbox",
    version="0.0.1",
    author="Probuild",
    author_email="admin@probuild.com",
    description="SMS Inbox - Phone-style SMS conversations for ERPNext",
    long_description=long_description,
    long_description_content_type="text/markdown",
    packages=find_packages(),
    include_package_data=True,
    zip_safe=False,
    install_requires=[
        "twilio"
    ],
)
